import { AxeBuilder } from '@axe-core/playwright';
import { nanoid } from 'nanoid';
import PQueue from 'p-queue';
import type { Page } from 'playwright';
import { scoreAlt } from '../lib/ai';
import {
  HTML_TRUNCATE_CHARS,
  VISION_MAX_IMAGES_PER_PAGE,
  VISION_MAX_PARALLEL,
} from '../lib/constants';
import type { Issue, Severity } from '../lib/types';

const IMPACT_TO_SEVERITY: Record<string, Severity> = {
  critical: 'critical',
  serious: 'serious',
  moderate: 'moderate',
  minor: 'minor',
};

const ALT_POOR_THRESHOLD = 2; // §21 T-A2.3: score ≤ 2 → alt-poor-quality

/**
 * Vision alt-text quality (PRD §F4): crops each alt'd <img> via element screenshot and
 * asks the vision model to judge it. ≤ VISION_MAX_IMAGES_PER_PAGE images, ≤ VISION_MAX_PARALLEL
 * in flight, every call cached. Calls OpenAI-compatible API via lib/ai.ts.
 */
export async function altQualityIssues(page: Page, pageId: string): Promise<Issue[]> {
  if ((process.env.OPENAI_API_KEY ?? '') === '') return []; // no key — degrade gracefully
  const imgs = page.locator('img[alt]:not([alt=""])');
  const total = Math.min(await imgs.count(), VISION_MAX_IMAGES_PER_PAGE);
  const pool = new PQueue({ concurrency: VISION_MAX_PARALLEL });
  const issues: Issue[] = [];

  await Promise.all(
    Array.from({ length: total }, (_, i) =>
      pool.add(async () => {
        const el = imgs.nth(i);
        const alt = (await el.getAttribute('alt')) ?? '';
        const png = await el.screenshot({ type: 'png' }).catch(() => null);
        if (png === null) return; // hidden / zero-size image — skip
        const verdict = await scoreAlt(png, alt).catch(() => null);
        if (verdict === null || verdict.score > ALT_POOR_THRESHOLD) return;
        const src = (await el.getAttribute('src')) ?? '';
        const selector = src.startsWith('data:')
          ? `img[alt="${alt}"]`
          : `img[src$="${src.split('/').pop() ?? src}"]`;
        issues.push({
          id: nanoid(10),
          pageId,
          source: 'alt-quality',
          rule: 'alt-poor-quality',
          severity: 'serious',
          selector,
          html: `<img src="${src.slice(0, 200)}" alt="${alt}">`.slice(0, HTML_TRUNCATE_CHARS),
          altVerdict: verdict,
        });
      }),
    ),
  );
  return issues;
}

/** Runs axe-core on a live page and maps violations to the shared Issue shape (PRD §19). */
export async function auditPage(page: Page, pageId: string): Promise<Issue[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node): Issue => ({
      id: nanoid(10),
      pageId,
      source: 'axe',
      rule: violation.id,
      severity: IMPACT_TO_SEVERITY[violation.impact ?? ''] ?? 'moderate',
      selector: node.target.map(String).join(' '),
      html: node.html.slice(0, HTML_TRUNCATE_CHARS),
    })),
  );
}
