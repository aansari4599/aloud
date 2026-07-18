import { GRADE_BANDS, SCORE_RULE_CAP, SCORE_WEIGHTS } from '../lib/constants';
import type { Issue } from '../lib/types';

/**
 * AccessScore for one page (PRD §11): 100 − Σ(weight × instances), deduction capped
 * per rule type so one repeated rule can't zero a site, floored at 0. Pure.
 */
export function scorePage(issues: Issue[]): number {
  const deductionByRule = new Map<string, number>();
  for (const issue of issues) {
    const current = deductionByRule.get(issue.rule) ?? 0;
    deductionByRule.set(
      issue.rule,
      Math.min(SCORE_RULE_CAP, current + SCORE_WEIGHTS[issue.severity]),
    );
  }
  let total = 0;
  for (const d of deductionByRule.values()) total += d;
  return Math.max(0, 100 - total);
}

/** Site score = mean of page scores, rounded. Pure. */
export function scoreSite(pagesIssues: Issue[][]): number {
  if (pagesIssues.length === 0) return 0;
  const sum = pagesIssues.map(scorePage).reduce((a, b) => a + b, 0);
  return Math.round(sum / pagesIssues.length);
}

/** Grade band label, A ≥ 90 … F (PRD §11). Pure. */
export function gradeFor(score: number): string {
  return GRADE_BANDS.find((b) => score >= b.min)?.grade ?? 'F';
}
