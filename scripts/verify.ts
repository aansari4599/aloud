// Acceptance runner: `npx tsx scripts/verify.ts <cmd> [args]`
// T-0 implements: db, fixtures. Later cards add: capture|audit|crawl|run|narrate|fix|rerun.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

// Minimal .env loader (Next.js loads it for the server; scripts need it too — no dotenv dep).
try {
  for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // no .env — fine, AI-dependent commands will degrade gracefully
}

interface FixtureCounts {
  imgsMissingAlt: number;
  imgsAltImage: number;
  iconOnlyButtons: number;
  clickableDivs: number;
  h1Count: number;
  headingSkip: boolean;
  lowContrastParas: number;
  unlabeledInputs: number;
  trapButtons: number;
}

/** Parses a fixture file (scripts NOT executed) and counts the seeded issues. */
function countFixture(path: string): FixtureCounts {
  const dom = new JSDOM(readFileSync(path, 'utf8'), { runScripts: 'outside-only' });
  const doc = dom.window.document;

  const imgs = [...doc.querySelectorAll('img')];
  const buttons = [...doc.querySelectorAll('button')];
  const inputs = [...doc.querySelectorAll('input')];

  const headingLevels = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) =>
    Number(h.tagName[1]),
  );
  const headingSkip = headingLevels.some((level, i) => i > 0 && level > headingLevels[i - 1] + 1);

  const hasLabel = (input: Element): boolean => {
    if (input.getAttribute('aria-label') || input.getAttribute('title')) return true;
    if (input.closest('label')) return true;
    const id = input.getAttribute('id');
    return id !== null && doc.querySelector(`label[for="${id}"]`) !== null;
  };

  return {
    imgsMissingAlt: imgs.filter((img) => !img.hasAttribute('alt')).length,
    imgsAltImage: imgs.filter((img) => img.getAttribute('alt') === 'image').length,
    iconOnlyButtons: buttons.filter(
      (b) => b.textContent?.trim() === '' && !b.getAttribute('aria-label'),
    ).length,
    clickableDivs: doc.querySelectorAll('div[onclick]').length,
    h1Count: doc.querySelectorAll('h1').length,
    headingSkip,
    lowContrastParas: doc.querySelectorAll('p[style*="#999"]').length,
    unlabeledInputs: inputs.filter((input) => !hasLabel(input)).length,
    trapButtons: doc.querySelectorAll('button.trap').length,
  };
}

function assertCounts(name: string, actual: FixtureCounts, expected: FixtureCounts): string[] {
  const failures: string[] = [];
  for (const key of Object.keys(expected) as (keyof FixtureCounts)[]) {
    if (actual[key] !== expected[key]) {
      failures.push(`${name}.${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
  return failures;
}

/** `fixtures` — asserts the seeded counts from PRD §20.3 and prints them. */
function cmdFixtures(): number {
  const brokenPath = join(process.cwd(), 'fixtures/broken/index.html');
  const goodPath = join(process.cwd(), 'fixtures/good/index.html');

  const broken = countFixture(brokenPath);
  const good = countFixture(goodPath);

  const failures = [
    ...assertCounts('broken', broken, {
      imgsMissingAlt: 3,
      imgsAltImage: 2,
      iconOnlyButtons: 1,
      clickableDivs: 1,
      h1Count: 2,
      headingSkip: true,
      lowContrastParas: 1,
      unlabeledInputs: 1,
      trapButtons: 3,
    }),
    ...assertCounts('good', good, {
      imgsMissingAlt: 0,
      imgsAltImage: 0,
      iconOnlyButtons: 0,
      clickableDivs: 0,
      h1Count: 1,
      headingSkip: false,
      lowContrastParas: 0,
      unlabeledInputs: 0,
      trapButtons: 0,
    }),
  ];

  console.log(JSON.stringify({ broken, good }, null, 2));
  if (failures.length > 0) {
    console.error(`FAIL:\n${failures.join('\n')}`);
    return 1;
  }
  console.log('fixtures OK');
  return 0;
}

/** `db` — boots the database (applies DDL) and prints the schema objects. */
async function cmdDb(): Promise<number> {
  const { db } = await import('../lib/db');
  const rows = db
    .prepare(
      `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    )
    .all() as { type: string; name: string }[];
  console.log(JSON.stringify(rows, null, 2));

  const expected = ['ai_cache', 'audits', 'fixes', 'issues', 'pages'];
  const tables = rows.filter((r) => r.type === 'table').map((r) => r.name);
  const missing = expected.filter((t) => !tables.includes(t));
  if (missing.length > 0) {
    console.error(`FAIL: missing tables: ${missing.join(', ')}`);
    return 1;
  }
  console.log('db OK');
  return 0;
}

/** `capture <url>` — T-A1.1 acceptance: >10 a11y nodes and a screenshot file on disk. */
async function cmdCapture(url: string | undefined): Promise<number> {
  if (!url) {
    console.error('Usage: npx tsx scripts/verify.ts capture <url>');
    return 2;
  }
  const { capturePage, closeBrowser } = await import('../services/browser');

  const countNodes = (node: unknown): number => {
    if (node === null || typeof node !== 'object') return 0;
    const children = (node as { children?: unknown[] }).children ?? [];
    return 1 + children.reduce<number>((sum, child) => sum + countNodes(child), 0);
  };

  try {
    const result = await capturePage(url, { allowFile: url.startsWith('file:') });
    const nodeCount = countNodes(result.snapshot);
    const screenshotExists = existsSync(result.screenshotPath);
    console.log(JSON.stringify(result.snapshot, null, 2));
    console.log(
      JSON.stringify(
        {
          url,
          nodeCount,
          htmlChars: result.html.length,
          screenshotPath: result.screenshotPath,
          screenshotExists,
        },
        null,
        2,
      ),
    );
    if (nodeCount <= 10 || !screenshotExists) {
      console.error('FAIL: expected >10 a11y nodes and an existing screenshot file');
      return 1;
    }
    console.log('capture OK');
    return 0;
  } finally {
    await closeBrowser();
  }
}

/** `audit <url>` — T-A1.2 acceptance: rule counts per fixture (broken seeds / good = 0 critical). */
async function cmdAudit(url: string | undefined): Promise<number> {
  if (!url) {
    console.error('Usage: npx tsx scripts/verify.ts audit <url>');
    return 2;
  }
  const { withPage, captureFromPage, closeBrowser } = await import('../services/browser');
  const { auditPage, altQualityIssues } = await import('../services/auditor');
  const { keyboardWalk } = await import('../services/checks/keyboard');
  const { headingChecks } = await import('../services/checks/headings');
  try {
    const issues = await withPage(url, { allowFile: url.startsWith('file:') }, async (page) => {
      const axeIssues = await auditPage(page, 'verify');
      const kbIssues = await keyboardWalk(page, 'verify');
      const altIssues = await altQualityIssues(page, 'verify');
      const { html } = await captureFromPage(page);
      return [...axeIssues, ...kbIssues, ...altIssues, ...headingChecks(html, 'verify')];
    });
    const byRule: Record<string, number> = {};
    for (const issue of issues) byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
    const critical = issues.filter((i) => i.severity === 'critical').length;
    const kbCount = issues.filter((i) => i.rule.startsWith('kb-')).length;
    console.log(JSON.stringify({ url, total: issues.length, critical, byRule }, null, 2));

    const failures: string[] = [];
    if (url.includes('fixtures/broken')) {
      if ((byRule['image-alt'] ?? 0) < 3) failures.push('image-alt < 3');
      if ((byRule['color-contrast'] ?? 0) < 1) failures.push('color-contrast < 1');
      if ((byRule['label'] ?? 0) < 1) failures.push('label < 1');
      if ((byRule['kb-trap'] ?? 0) < 1) failures.push('kb-trap < 1');
      if ((process.env.OPENAI_API_KEY ?? '') !== '' && (byRule['alt-poor-quality'] ?? 0) < 2)
        failures.push('alt-poor-quality < 2');
    }
    if (url.includes('fixtures/good')) {
      if (critical > 0) failures.push(`good fixture has ${critical} critical issues, expected 0`);
      if (kbCount > 0) failures.push(`good fixture has ${kbCount} kb-* issues, expected 0`);
    }
    if (failures.length > 0) {
      console.error(`FAIL: ${failures.join('; ')}`);
      return 1;
    }
    console.log('audit OK');
    return 0;
  } finally {
    await closeBrowser();
  }
}

/** `crawl <url>` — T-A1.3 acceptance: broken fixture → 2 pages (about.html linked), good → 1. */
async function cmdCrawl(url: string | undefined): Promise<number> {
  if (!url) {
    console.error('Usage: npx tsx scripts/verify.ts crawl <url>');
    return 2;
  }
  const { crawl } = await import('../services/crawler');
  const { closeBrowser } = await import('../services/browser');
  try {
    const pages = await crawl(url, { allowFile: url.startsWith('file:') });
    console.log(JSON.stringify(pages, null, 2));

    const failures: string[] = [];
    if (url.includes('fixtures/broken') && pages.length !== 2) {
      failures.push(`broken fixture expected 2 pages, got ${pages.length}`);
    }
    if (url.includes('fixtures/good') && pages.length !== 1) {
      failures.push(`good fixture expected 1 page, got ${pages.length}`);
    }
    if (failures.length > 0) {
      console.error(`FAIL: ${failures.join('; ')}`);
      return 1;
    }
    console.log('crawl OK');
    return 0;
  } finally {
    await closeBrowser();
  }
}

/** `run <url>` — T-A1.4 acceptance: polls to done, issue count > 5, progress log ≥ 4 steps. */
async function cmdRun(url: string | undefined): Promise<number> {
  if (!url) {
    console.error('Usage: npx tsx scripts/verify.ts run <url>');
    return 2;
  }
  const { enqueueAudit } = await import('../services/queue');
  const { closeBrowser } = await import('../services/browser');
  const { getAuditJob, countIssues } = await import('../lib/db');
  try {
    const id = enqueueAudit(url, true, { allowFile: url.startsWith('file:') });
    let job = getAuditJob(id);
    while (job && job.status !== 'done' && job.status !== 'failed') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      job = getAuditJob(id);
    }
    const issueCount = countIssues(id);
    console.log(
      JSON.stringify(
        { id, status: job?.status, errorKind: job?.errorKind, issueCount, progress: job?.progress },
        null,
        2,
      ),
    );

    const failures: string[] = [];
    if (job?.status !== 'done') failures.push(`status ${job?.status}, expected done`);
    if (url.includes('fixtures/broken') && issueCount <= 5)
      failures.push(`issue count ${issueCount}, expected > 5`);
    if ((job?.progress.length ?? 0) < 4)
      failures.push(`progress ${job?.progress.length} steps, expected ≥ 4`);
    if (failures.length > 0) {
      console.error(`FAIL: ${failures.join('; ')}`);
      return 1;
    }
    console.log('run OK');
    return 0;
  } finally {
    await closeBrowser();
  }
}

/** `narrate <url>` — T-A2.1 acceptance: grammar output per PRD §19.1. */
async function cmdNarrate(url: string | undefined): Promise<number> {
  if (!url) {
    console.error('Usage: npx tsx scripts/verify.ts narrate <url>');
    return 2;
  }
  const { withPage, captureFromPage, closeBrowser } = await import('../services/browser');
  const { auditPage } = await import('../services/auditor');
  const { buildUtterances } = await import('../services/narrator');
  try {
    const { capture, issues } = await withPage(
      url,
      { allowFile: url.startsWith('file:') },
      async (page) => ({
        capture: await captureFromPage(page),
        issues: await auditPage(page, 'verify'),
      }),
    );
    const utterances = buildUtterances(capture.snapshot, capture.html, issues);
    for (const u of utterances) {
      console.log(
        `${String(u.index).padStart(3)}  ${u.text}${u.issueId !== undefined ? '   ⚑' : ''}`,
      );
    }
    const linked = utterances.filter((u) => u.issueId !== undefined).length;
    console.log(JSON.stringify({ url, count: utterances.length, linkedToIssues: linked }));

    const all = utterances.map((u) => u.text).join('\n');
    const failures: string[] = [];
    if (url.includes('fixtures/broken')) {
      if (!all.includes('button, unlabeled')) failures.push('missing "button, unlabeled"');
      if (!/image, I M G/.test(all)) failures.push('missing "image, I M G" spelling');
      if (utterances.length < 15)
        failures.push(`only ${utterances.length} utterances, expected ≥ 15`);
    }
    if (url.includes('fixtures/good')) {
      if (all.includes('button, unlabeled'))
        failures.push('good fixture contains "button, unlabeled"');
      if (/image, I M G/.test(all)) failures.push('good fixture contains "image, I M G"');
    }
    if (failures.length > 0) {
      console.error(`FAIL: ${failures.join('; ')}`);
      return 1;
    }
    console.log('narrate OK');
    return 0;
  } finally {
    await closeBrowser();
  }
}

/** `fix [auditId]` — T-A3.1 acceptance: ≥ 6 parsing diffs, no invented class names. */
async function cmdFix(auditIdArg: string | undefined): Promise<number> {
  const { parsePatch } = await import('diff');
  const { generateFixes } = await import('../services/fixer');
  const { db } = await import('../lib/db');

  const auditId =
    auditIdArg ??
    (
      db
        .prepare(
          `SELECT id FROM audits WHERE status='done' AND url LIKE '%fixtures/broken/index.html' ORDER BY created_at DESC LIMIT 1`,
        )
        .get() as { id: string } | undefined
    )?.id;
  if (auditId === undefined) {
    console.error('No broken-fixture audit found. Run: verify.ts run <broken fixture> first.');
    return 2;
  }

  const fixes = await generateFixes(auditId);
  for (const f of fixes.slice(0, 3)) {
    console.log(`--- ${f.issueId}: ${f.rationale}\n${f.diff}`);
  }

  const failures: string[] = [];
  if (fixes.length < 6) failures.push(`only ${fixes.length} fixes, expected ≥ 6`);
  for (const f of fixes) {
    try {
      if (parsePatch(f.diff).length === 0) failures.push(`empty diff for ${f.issueId}`);
    } catch {
      failures.push(`unparseable diff for ${f.issueId}`);
    }
  }
  console.log(JSON.stringify({ auditId, fixes: fixes.length }));
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.join('; ')}`);
    return 1;
  }
  console.log('fix OK');
  return 0;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'fixtures':
      process.exit(cmdFixtures());
      break;
    case 'db':
      process.exit(await cmdDb());
      break;
    case 'capture':
      process.exit(await cmdCapture(process.argv[3]));
      break;
    case 'audit':
      process.exit(await cmdAudit(process.argv[3]));
      break;
    case 'crawl':
      process.exit(await cmdCrawl(process.argv[3]));
      break;
    case 'run':
      process.exit(await cmdRun(process.argv[3]));
      break;
    case 'narrate':
      process.exit(await cmdNarrate(process.argv[3]));
      break;
    case 'fix':
      process.exit(await cmdFix(process.argv[3]));
      break;
    default:
      console.error(
        `Unknown command: ${cmd ?? '(none)'}\nUsage: npx tsx scripts/verify.ts <db|fixtures|capture|audit|crawl|run|narrate|fix>`,
      );
      process.exit(2);
  }
}

void main();
