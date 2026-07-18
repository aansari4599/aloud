import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import PQueue from 'p-queue';
import { JOB_CONCURRENCY, PAGES_IN_PARALLEL } from '../lib/constants';
import {
  appendProgress,
  createAudit,
  failAudit,
  savePageWithIssues,
  setAuditStatus,
  setPageUtterances,
  setScoreBefore,
} from '../lib/db';
import { AppError } from '../lib/errors';
import { log } from '../lib/log';
import { PAGE_HTML_DIR } from '../lib/paths';
import type { SsrfOptions } from '../lib/ssrf';
import type { Issue } from '../lib/types';
import { withPage, captureFromPage, type A11ySnapshot } from './browser';
import { auditPage, altQualityIssues } from './auditor';
import { headingChecks } from './checks/headings';
import { keyboardWalk } from './checks/keyboard';
import { buildUtterances } from './narrator';
import { crawl } from './crawler';
import { gradeFor, scoreSite } from './scorer';

const jobs = new PQueue({ concurrency: JOB_CONCURRENCY });

/**
 * Creates the audit row and enqueues the job. Returns the audit id immediately;
 * progress and results land in the db (poll via GET /api/audits/:id). Writes db.
 */
export function enqueueAudit(url: string, crawlFlag: boolean, ssrf: SsrfOptions = {}): string {
  const id = nanoid(10);
  createAudit(id, url, crawlFlag);
  void jobs.add(() => runAudit(id, url, crawlFlag, ssrf)); // fire-and-forget: status lives in db
  return id;
}

interface PageData {
  pageId: string;
  url: string;
  html: string;
  snapshot: A11ySnapshot | null;
  issues: Issue[];
  issueCount: number;
  imageCount: number;
}

/** Navigates one page once, capturing artifacts and axe issues together. Writes db + browser. */
async function auditOnePage(jobId: string, pageUrl: string, ssrf: SsrfOptions): Promise<PageData> {
  const pageId = nanoid(10);
  const started = Date.now();
  const { capture, issues } = await withPage(pageUrl, ssrf, async (page) => {
    const axeIssues = await auditPage(page, pageId);
    const kbIssues = await keyboardWalk(page, pageId);
    const altIssues = await altQualityIssues(page, pageId);
    const captured = await captureFromPage(page);
    return {
      capture: captured,
      issues: [...axeIssues, ...kbIssues, ...altIssues, ...headingChecks(captured.html, pageId)],
    };
  });
  savePageWithIssues(
    {
      id: pageId,
      auditId: jobId,
      url: pageUrl,
      screenshotPath: capture.screenshotPath,
      snapshotJson: JSON.stringify(capture.snapshot),
    },
    issues,
  );
  // Rendered HTML on disk — fixer needs surrounding context, patcher applies fixes to it.
  mkdirSync(PAGE_HTML_DIR, { recursive: true });
  writeFileSync(join(PAGE_HTML_DIR, `${pageId}.html`), capture.html);
  const imageCount = (capture.html.match(/<img\b/gi) ?? []).length;
  log(jobId, 'page-audited', Date.now() - started, { url: pageUrl, issues: issues.length });
  return {
    pageId,
    url: pageUrl,
    html: capture.html,
    snapshot: capture.snapshot,
    issues,
    issueCount: issues.length,
    imageCount,
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The job pipeline: statuses per PRD §19, every stage appends a ProgressEvent. */
async function runAudit(
  id: string,
  url: string,
  crawlFlag: boolean,
  ssrf: SsrfOptions,
): Promise<void> {
  try {
    const site = new URL(url);
    const siteName = site.protocol === 'file:' ? url.split('/').slice(-2).join('/') : site.hostname;

    setAuditStatus(id, 'loading');
    appendProgress(id, `Loading ${siteName}…`);
    const root = await auditOnePage(id, url, ssrf);
    appendProgress(id, `Found ${plural(root.imageCount, 'image')}…`);
    appendProgress(id, `Running accessibility checks… ${plural(root.issueCount, 'issue')} so far`);

    setAuditStatus(id, 'crawling');
    let urls: string[] = [site.href];
    if (crawlFlag) {
      appendProgress(id, 'Looking for more pages…');
      urls = await crawl(url, ssrf);
      appendProgress(id, `Auditing ${plural(urls.length, 'page')} total`);
    }

    setAuditStatus(id, 'auditing');
    const rest = urls.slice(1);
    const pageDatas: PageData[] = [root];
    const pages = new PQueue({ concurrency: PAGES_IN_PARALLEL });
    await Promise.all(
      rest.map((pageUrl) =>
        pages.add(async () => {
          appendProgress(id, `Checking ${pageUrl.split('/').pop() ?? pageUrl}…`);
          const result = await auditOnePage(id, pageUrl, ssrf);
          pageDatas.push(result);
          appendProgress(id, `${plural(result.issueCount, 'issue')} found`, pageUrl);
        }),
      ),
    );

    setAuditStatus(id, 'narrating');
    appendProgress(id, 'Listening to the page like a screen reader…');
    let utteranceTotal = 0;
    for (const data of pageDatas) {
      const utterances = buildUtterances(data.snapshot, data.html, data.issues);
      setPageUtterances(data.pageId, utterances);
      utteranceTotal += utterances.length;
    }
    appendProgress(id, `Narration ready — ${plural(utteranceTotal, 'utterance')}`);

    setAuditStatus(id, 'scoring');
    appendProgress(id, 'Computing AccessScore…');
    const before = scoreSite(pageDatas.map((p) => p.issues));
    setScoreBefore(id, before);
    appendProgress(id, `AccessScore: ${before} (${gradeFor(before)})`);
    // TODO (T-B2.3): batched explainIssues call for top issues once OPENAI_API_KEY lands

    setAuditStatus(id, 'done');
    appendProgress(id, 'Audit complete');
  } catch (err) {
    const kind = err instanceof AppError ? err.kind : 'INTERNAL';
    const message = err instanceof Error ? err.message : String(err);
    failAudit(id, kind);
    appendProgress(id, 'Audit failed', kind);
    log(id, 'audit-failed', 0, { ok: false, kind, message });
  }
}
