// Pre-bakes the landing gallery (T-A4.2): runs the three gallery audits through the
// real pipeline so the db + screenshots + page HTML are all local. After this, the
// gallery and its /r/ permalinks serve with zero external network — wifi-proof demo.
// Usage: npx tsx scripts/prebake.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

try {
  for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // no .env — AI-dependent stages degrade gracefully
}

const GALLERY_URLS = [
  `file://${process.cwd()}/fixtures/broken/index.html`,
  `file://${process.cwd()}/fixtures/good/index.html`,
  'https://example.com',
];

async function main(): Promise<void> {
  const { enqueueAudit } = await import('../services/queue');
  const { closeBrowser } = await import('../services/browser');
  const { getAuditJob } = await import('../lib/db');

  try {
    for (const url of GALLERY_URLS) {
      const id = enqueueAudit(url, true, { allowFile: url.startsWith('file:') });
      let job = getAuditJob(id);
      while (job && job.status !== 'done' && job.status !== 'failed') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        job = getAuditJob(id);
      }
      if (job?.status !== 'done') {
        console.error(`FAIL: ${url} → ${job?.status} (${job?.errorKind ?? '?'})`);
        process.exitCode = 1;
        continue;
      }
      console.log(`baked: ${url} → /r/${id} (score ${job.scoreBefore})`);
    }
  } finally {
    await closeBrowser();
  }
}

void main();
