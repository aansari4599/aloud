// Acceptance runner: `npx tsx scripts/verify.ts <cmd> [args]`
// T-0 implements: db, fixtures. Later cards add: capture|audit|crawl|run|narrate|fix|rerun.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

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
  const { withPage, closeBrowser } = await import('../services/browser');
  const { auditPage } = await import('../services/auditor');
  try {
    const issues = await withPage(url, { allowFile: url.startsWith('file:') }, (page) =>
      auditPage(page, 'verify'),
    );
    const byRule: Record<string, number> = {};
    for (const issue of issues) byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
    const critical = issues.filter((i) => i.severity === 'critical').length;
    console.log(JSON.stringify({ url, total: issues.length, critical, byRule }, null, 2));

    const failures: string[] = [];
    if (url.includes('fixtures/broken')) {
      if ((byRule['image-alt'] ?? 0) < 3) failures.push('image-alt < 3');
      if ((byRule['color-contrast'] ?? 0) < 1) failures.push('color-contrast < 1');
      if ((byRule['label'] ?? 0) < 1) failures.push('label < 1');
    }
    if (url.includes('fixtures/good') && critical > 0) {
      failures.push(`good fixture has ${critical} critical issues, expected 0`);
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
    default:
      console.error(
        `Unknown command: ${cmd ?? '(none)'}\nUsage: npx tsx scripts/verify.ts <db|fixtures|capture|audit>`,
      );
      process.exit(2);
  }
}

void main();
