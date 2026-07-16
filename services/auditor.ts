import { AxeBuilder } from '@axe-core/playwright';
import { nanoid } from 'nanoid';
import type { Page } from 'playwright';
import { HTML_TRUNCATE_CHARS } from '../lib/constants';
import type { Issue, Severity } from '../lib/types';

const IMPACT_TO_SEVERITY: Record<string, Severity> = {
  critical: 'critical',
  serious: 'serious',
  moderate: 'moderate',
  minor: 'minor',
};

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
