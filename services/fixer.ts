import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { nanoid } from 'nanoid';
import PQueue from 'p-queue';
import { generateFix } from '../lib/ai';
import { getPages, saveFixes } from '../lib/db';
import { log } from '../lib/log';
import { PAGE_HTML_DIR } from '../lib/paths';
import type { Fix, Issue } from '../lib/types';

// v1 fixable sources (PRD §21 T-A3.1); everything else is marked manual in the UI.
const FIXABLE_RULES = new Set([
  'image-alt',
  'alt-poor-quality',
  'button-name',
  'label',
  'heading-order',
]);

/** Pure. */
export function isFixable(issue: Issue): boolean {
  return FIXABLE_RULES.has(issue.rule);
}

const CONTEXT_CHARS = 1_500; // ≈ ±20 lines of typical markup
const FIX_PARALLEL = 2; // gentle on free-tier per-minute rate limits

/** The issue's outerHTML located inside the stored page HTML, with surrounding context. Reads disk. */
function contextFor(issue: Issue): string {
  try {
    const html = readFileSync(join(PAGE_HTML_DIR, `${issue.pageId}.html`), 'utf8');
    const probe = issue.html.slice(0, 120);
    const at = html.indexOf(probe);
    if (at === -1) return issue.html;
    return html.slice(Math.max(0, at - CONTEXT_CHARS), at + probe.length + CONTEXT_CHARS);
  } catch {
    return issue.html; // page html missing (old audit) — element alone still works
  }
}

const classTokens = (html: string): Set<string> =>
  new Set(
    (html.match(/class="([^"]*)"/g) ?? [])
      .flatMap((m) => m.slice(7, -1).split(/\s+/))
      .filter((c) => c !== ''),
  );

/** True when the patch introduces a class name absent from the original element. Pure. */
function inventsClassNames(originalHtml: string, patchedHtml: string): boolean {
  const original = classTokens(originalHtml);
  return [...classTokens(patchedHtml)].some((c) => !original.has(c));
}

/**
 * Generates Fix rows for an audit's fixable issues (all, or the given issue ids).
 * Model calls via lib/ai.ts (cached), ≤ VISION_MAX_PARALLEL in flight. Writes db.
 */
export async function generateFixes(auditId: string, issueIds?: string[]): Promise<Fix[]> {
  const issues = getPages(auditId)
    .flatMap((p) => p.issues)
    .filter(isFixable)
    .filter((i) => issueIds === undefined || issueIds.includes(i.id));

  const pool = new PQueue({ concurrency: FIX_PARALLEL });
  const fixes: Fix[] = [];

  await Promise.all(
    issues.map((issue) =>
      pool.add(async () => {
        const generated = await generateFix(issue, contextFor(issue)).catch((err: unknown) => {
          log(auditId, 'fix-failed', 0, {
            ok: false,
            rule: issue.rule,
            selector: issue.selector,
            message: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
          return null;
        });
        if (generated === null) return;
        if (inventsClassNames(issue.html, generated.patchedHtml)) {
          log(auditId, 'fix-rejected-classes', 0, { ok: false, rule: issue.rule });
          return;
        }
        fixes.push({
          id: nanoid(10),
          issueId: issue.id,
          diff: createTwoFilesPatch('before.html', 'after.html', issue.html, generated.patchedHtml),
          patchedHtml: generated.patchedHtml,
          rationale: generated.rationale,
          applied: false,
        });
      }),
    ),
  );

  saveFixes(fixes);
  return fixes;
}
