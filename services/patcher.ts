import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { nanoid } from 'nanoid';
import { getFixesForAudit, getAuditJob, getPages, markFixApplied, setScoreAfter } from '../lib/db';
import { AppError } from '../lib/errors';
import { log } from '../lib/log';
import { PAGE_HTML_DIR, PATCHED_DIR } from '../lib/paths';
import type { Issue, PageResult } from '../lib/types';
import { auditPage } from './auditor';
import { captureFromPage, withPage } from './browser';
import { headingChecks } from './checks/headings';
import { keyboardWalk } from './checks/keyboard';
import { buildUtterances } from './narrator';
import { scoreSite } from './scorer';

export interface RerunResult {
  scoreBefore: number;
  scoreAfter: number;
  pages: PageResult[];
}

/**
 * The verify loop (PRD §F6): applies each fix's patchedHtml by selector into the stored
 * page HTML (jsdom, scripts parsed not executed), writes /data/patched/<pageId>.html,
 * re-audits via file:// (never re-fetches the live site), recomputes AccessScore.
 * Writes db + disk, navigates browser. Vision re-scoring is skipped (quota; fixed alts
 * simply produce no issues).
 */
export async function rerunAudit(auditId: string): Promise<RerunResult> {
  const job = getAuditJob(auditId);
  if (!job || job.status !== 'done') {
    throw new AppError('INTERNAL', 'Audit not found or not finished');
  }
  const pages = getPages(auditId);
  const fixes = getFixesForAudit(auditId);
  if (fixes.length === 0) {
    throw new AppError('INTERNAL', 'No fixes generated yet — call /fixes first');
  }
  const fixByIssue = new Map(fixes.map((f) => [f.issueId, f]));
  mkdirSync(PATCHED_DIR, { recursive: true });

  const afterPages: PageResult[] = [];
  const afterIssuesPerPage: Issue[][] = [];

  for (const page of pages) {
    let html: string;
    try {
      html = readFileSync(join(PAGE_HTML_DIR, `${page.id}.html`), 'utf8');
    } catch {
      throw new AppError('INTERNAL', `Stored HTML missing for page ${page.id} — re-run the audit`);
    }

    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const doc = dom.window.document;
    let appliedCount = 0;
    for (const issue of page.issues) {
      const fix = fixByIssue.get(issue.id);
      if (fix === undefined) continue;
      let el: Element | null = null;
      try {
        el = doc.querySelector(issue.selector);
      } catch {
        // axe can emit selectors jsdom rejects — skip rather than fail the rerun
      }
      if (el === null) {
        log(auditId, 'patch-skipped', 0, { selector: issue.selector });
        continue;
      }
      el.outerHTML = fix.patchedHtml;
      markFixApplied(fix.id);
      appliedCount += 1;
    }

    const patchedPath = join(PATCHED_DIR, `${page.id}.html`);
    writeFileSync(patchedPath, dom.serialize());
    log(auditId, 'page-patched', 0, { page: page.id, applied: appliedCount });

    const patchedUrl = pathToFileURL(patchedPath).href;
    const afterPageId = nanoid(10);
    const { capture, issues } = await withPage(patchedUrl, { allowFile: true }, async (p) => {
      const axeIssues = await auditPage(p, afterPageId);
      const kbIssues = await keyboardWalk(p, afterPageId);
      const captured = await captureFromPage(p);
      return {
        capture: captured,
        issues: [...axeIssues, ...kbIssues, ...headingChecks(captured.html, afterPageId)],
      };
    });

    afterIssuesPerPage.push(issues);
    afterPages.push({
      id: afterPageId,
      auditId,
      url: page.url,
      screenshotPath: capture.screenshotPath,
      issues,
      utterances: buildUtterances(capture.snapshot, capture.html, issues),
    });
  }

  const scoreAfter = scoreSite(afterIssuesPerPage);
  setScoreAfter(auditId, scoreAfter);
  log(auditId, 'rerun-complete', 0, { scoreBefore: job.scoreBefore, scoreAfter });

  return { scoreBefore: job.scoreBefore ?? 0, scoreAfter, pages: afterPages };
}
