import { nanoid } from 'nanoid';
import PQueue from 'p-queue';
import { JOB_CONCURRENCY, PAGES_IN_PARALLEL } from '../lib/constants';
import {
  appendProgress,
  createAudit,
  failAudit,
  savePageWithIssues,
  setAuditStatus,
} from '../lib/db';
import { AppError } from '../lib/errors';
import { log } from '../lib/log';
import type { SsrfOptions } from '../lib/ssrf';
import { withPage, captureFromPage } from './browser';
import { auditPage } from './auditor';
import { crawl } from './crawler';

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

/** Navigates one page once, capturing artifacts and axe issues together. Writes db + browser. */
async function auditOnePage(jobId: string, pageUrl: string, ssrf: SsrfOptions): Promise<number> {
  const pageId = nanoid(10);
  const started = Date.now();
  const { capture, issues } = await withPage(pageUrl, ssrf, async (page) => ({
    capture: await captureFromPage(page),
    issues: await auditPage(page, pageId),
  }));
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
  log(jobId, 'page-audited', Date.now() - started, { url: pageUrl, issues: issues.length });
  return issues.length;
}

/** The job pipeline: statuses per PRD §19, every stage appends a ProgressEvent. */
async function runAudit(
  id: string,
  url: string,
  crawlFlag: boolean,
  ssrf: SsrfOptions,
): Promise<void> {
  try {
    setAuditStatus(id, 'loading');
    appendProgress(id, 'Loading page', url);
    const rootIssues = await auditOnePage(id, url, ssrf);
    appendProgress(id, `Found ${rootIssues} issues on the first page`);

    setAuditStatus(id, 'crawling');
    let urls: string[] = [new URL(url).href];
    if (crawlFlag) {
      appendProgress(id, 'Discovering pages');
      urls = await crawl(url, ssrf);
      appendProgress(id, `Found ${urls.length} pages to audit`);
    }

    setAuditStatus(id, 'auditing');
    const rest = urls.slice(1);
    const pages = new PQueue({ concurrency: PAGES_IN_PARALLEL });
    await Promise.all(
      rest.map((pageUrl) =>
        pages.add(async () => {
          appendProgress(id, 'Auditing page', pageUrl);
          const count = await auditOnePage(id, pageUrl, ssrf);
          appendProgress(id, `Found ${count} issues`, pageUrl);
        }),
      ),
    );

    setAuditStatus(id, 'narrating');
    appendProgress(id, 'Building narration'); // TODO (T-A2.1): generate utterances per page

    setAuditStatus(id, 'scoring');
    appendProgress(id, 'Computing AccessScore'); // TODO (T-A3.2): scorer + explanations

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
