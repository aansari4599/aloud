import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { DATABASE_PATH } from './paths';
import type {
  AuditJob,
  AuditStatus,
  ErrorKind,
  Fix,
  Issue,
  PageResult,
  ProgressEvent,
  Utterance,
} from './types';

// DDL is normative in PRD §19.3.
const DDL = `
CREATE TABLE IF NOT EXISTS audits (id TEXT PRIMARY KEY, url TEXT NOT NULL, crawl INTEGER,
  status TEXT, error_kind TEXT, score_before INTEGER, score_after INTEGER,
  progress_json TEXT DEFAULT '[]', created_at TEXT);
CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, audit_id TEXT REFERENCES audits(id),
  url TEXT, screenshot_path TEXT, snapshot_json TEXT, utterances_json TEXT);
CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, page_id TEXT REFERENCES pages(id),
  source TEXT, rule TEXT, severity TEXT, selector TEXT, html TEXT,
  explanation TEXT, alt_verdict_json TEXT);
CREATE TABLE IF NOT EXISTS fixes (id TEXT PRIMARY KEY, issue_id TEXT REFERENCES issues(id),
  diff TEXT, patched_html TEXT, rationale TEXT, applied INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, value_json TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_pages_audit ON pages(audit_id);
CREATE INDEX IF NOT EXISTS idx_issues_page ON issues(page_id);
CREATE INDEX IF NOT EXISTS idx_fixes_issue ON fixes(issue_id);
`;

/** Opens the SQLite database (WAL) and applies the DDL. Writes the db file. */
function open(): Database.Database {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
  const database = new Database(DATABASE_PATH);
  database.pragma('journal_mode = WAL');
  database.exec(DDL);
  return database;
}

// Runs once at module load (boot). Server-only import.
export const db = open();

// Prepared statements: created once at module scope, reused (AGENTS.md efficiency standards).
const stmtInsertAudit = db.prepare(
  `INSERT INTO audits (id, url, crawl, status, progress_json, created_at) VALUES (?, ?, ?, 'queued', '[]', ?)`,
);
const stmtSetStatus = db.prepare(`UPDATE audits SET status = ? WHERE id = ?`);
const stmtFailAudit = db.prepare(
  `UPDATE audits SET status = 'failed', error_kind = ? WHERE id = ?`,
);
const stmtGetAudit = db.prepare(`SELECT * FROM audits WHERE id = ?`);
const stmtSetProgress = db.prepare(`UPDATE audits SET progress_json = ? WHERE id = ?`);
const stmtInsertPage = db.prepare(
  `INSERT INTO pages (id, audit_id, url, screenshot_path, snapshot_json, utterances_json) VALUES (?, ?, ?, ?, ?, ?)`,
);
const stmtInsertIssue = db.prepare(
  `INSERT INTO issues (id, page_id, source, rule, severity, selector, html, explanation, alt_verdict_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const stmtCountIssues = db.prepare(
  `SELECT COUNT(*) AS n FROM issues JOIN pages ON issues.page_id = pages.id WHERE pages.audit_id = ?`,
);

interface AuditRow {
  id: string;
  url: string;
  crawl: number;
  status: AuditStatus;
  error_kind: ErrorKind | null;
  score_before: number | null;
  score_after: number | null;
  progress_json: string;
  created_at: string;
}

/** Inserts a queued audit row. Writes db. */
export function createAudit(id: string, url: string, crawl: boolean): void {
  stmtInsertAudit.run(id, url, crawl ? 1 : 0, new Date().toISOString());
}

/** Writes db. */
export function setAuditStatus(id: string, status: AuditStatus): void {
  stmtSetStatus.run(status, id);
}

/** Marks the audit failed with its ErrorKind. Writes db. */
export function failAudit(id: string, kind: ErrorKind): void {
  stmtFailAudit.run(kind, id);
}

/** Appends one ProgressEvent to the audit's append-only log. Writes db. */
export function appendProgress(id: string, step: string, detail?: string): void {
  const row = stmtGetAudit.get(id) as AuditRow | undefined;
  if (!row) return;
  const events = JSON.parse(row.progress_json) as ProgressEvent[];
  events.push({ at: new Date().toISOString(), step, ...(detail === undefined ? {} : { detail }) });
  stmtSetProgress.run(JSON.stringify(events), id);
}

/** Reads db. */
export function getAuditJob(id: string): AuditJob | undefined {
  const row = stmtGetAudit.get(id) as AuditRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    url: row.url,
    crawl: row.crawl === 1,
    status: row.status,
    ...(row.error_kind === null ? {} : { errorKind: row.error_kind }),
    progress: JSON.parse(row.progress_json) as ProgressEvent[],
    ...(row.score_before === null ? {} : { scoreBefore: row.score_before }),
    ...(row.score_after === null ? {} : { scoreAfter: row.score_after }),
    createdAt: row.created_at,
  };
}

/** Total issues across an audit's pages. Reads db. */
export function countIssues(auditId: string): number {
  return (stmtCountIssues.get(auditId) as { n: number }).n;
}

const stmtSetScoreBefore = db.prepare(`UPDATE audits SET score_before = ? WHERE id = ?`);
const stmtSetScoreAfter = db.prepare(`UPDATE audits SET score_after = ? WHERE id = ?`);

/** Writes db. */
export function setScoreBefore(id: string, score: number): void {
  stmtSetScoreBefore.run(score, id);
}

/** Writes db. */
export function setScoreAfter(id: string, score: number): void {
  stmtSetScoreAfter.run(score, id);
}

const stmtSetUtterances = db.prepare(`UPDATE pages SET utterances_json = ? WHERE id = ?`);
const stmtScreenshotPath = db.prepare(`SELECT screenshot_path FROM pages WHERE id = ?`);
const stmtLatestByUrl = db.prepare(
  `SELECT id, url, score_before FROM audits WHERE status = 'done' AND url LIKE ? ORDER BY created_at DESC LIMIT 1`,
);

/** Latest completed audit whose url matches a LIKE pattern (gallery lookup). Reads db. */
export function findLatestAuditByUrlPattern(
  pattern: string,
): { id: string; url: string; scoreBefore: number | null } | undefined {
  const row = stmtLatestByUrl.get(pattern) as
    { id: string; url: string; score_before: number | null } | undefined;
  return row === undefined
    ? undefined
    : { id: row.id, url: row.url, scoreBefore: row.score_before };
}

/** Screenshot file path for a page id (paths are written by us, never user input). Reads db. */
export function getScreenshotPath(pageId: string): string | undefined {
  const row = stmtScreenshotPath.get(pageId) as { screenshot_path: string } | undefined;
  return row?.screenshot_path;
}

/** Writes db. */
export function setPageUtterances(pageId: string, utterances: Utterance[]): void {
  stmtSetUtterances.run(JSON.stringify(utterances), pageId);
}

const stmtPagesForAudit = db.prepare(
  `SELECT id, url, screenshot_path, utterances_json FROM pages WHERE audit_id = ?`,
);
const stmtIssuesForPage = db.prepare(
  `SELECT id, source, rule, severity, selector, html, explanation, alt_verdict_json FROM issues WHERE page_id = ?`,
);

interface IssueRow {
  id: string;
  source: Issue['source'];
  rule: string;
  severity: Issue['severity'];
  selector: string;
  html: string;
  explanation: string | null;
  alt_verdict_json: string | null;
}

/**
 * Pages with issues + utterances for the API payload (PRD §19.2).
 * snapshot_json deliberately never leaves the server (AGENTS.md payload discipline). Reads db.
 */
export function getPages(auditId: string): PageResult[] {
  const rows = stmtPagesForAudit.all(auditId) as {
    id: string;
    url: string;
    screenshot_path: string;
    utterances_json: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    auditId,
    url: row.url,
    screenshotPath: row.screenshot_path,
    utterances: JSON.parse(row.utterances_json) as Utterance[],
    issues: (stmtIssuesForPage.all(row.id) as IssueRow[]).map((r): Issue => ({
      id: r.id,
      pageId: row.id,
      source: r.source,
      rule: r.rule,
      severity: r.severity,
      selector: r.selector,
      html: r.html,
      ...(r.explanation === null ? {} : { explanation: r.explanation }),
      ...(r.alt_verdict_json === null
        ? {}
        : { altVerdict: JSON.parse(r.alt_verdict_json) as Issue['altVerdict'] }),
    })),
  }));
}

const stmtInsertFix = db.prepare(
  `INSERT OR REPLACE INTO fixes (id, issue_id, diff, patched_html, rationale, applied) VALUES (?, ?, ?, ?, ?, ?)`,
);
const stmtFixesForAudit = db.prepare(
  `SELECT fixes.id, fixes.issue_id, fixes.diff, fixes.patched_html, fixes.rationale, fixes.applied
   FROM fixes JOIN issues ON fixes.issue_id = issues.id JOIN pages ON issues.page_id = pages.id
   WHERE pages.audit_id = ?`,
);

/** Persists fixes in one transaction. Writes db. */
export const saveFixes = db.transaction((fixes: Fix[]): void => {
  for (const f of fixes) {
    stmtInsertFix.run(f.id, f.issueId, f.diff, f.patchedHtml, f.rationale, f.applied ? 1 : 0);
  }
});

const stmtMarkApplied = db.prepare(`UPDATE fixes SET applied = 1 WHERE id = ?`);

/** Writes db. */
export function markFixApplied(fixId: string): void {
  stmtMarkApplied.run(fixId);
}

/** All fixes for an audit. Reads db. */
export function getFixesForAudit(auditId: string): Fix[] {
  const rows = stmtFixesForAudit.all(auditId) as {
    id: string;
    issue_id: string;
    diff: string;
    patched_html: string;
    rationale: string;
    applied: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    issueId: r.issue_id,
    diff: r.diff,
    patchedHtml: r.patched_html,
    rationale: r.rationale,
    applied: r.applied === 1,
  }));
}

/** Persists a page and its issues in one transaction (AGENTS.md: one transaction per page). Writes db. */
export const savePageWithIssues = db.transaction(
  (
    page: {
      id: string;
      auditId: string;
      url: string;
      screenshotPath: string;
      snapshotJson: string;
    },
    issues: Issue[],
  ): void => {
    stmtInsertPage.run(
      page.id,
      page.auditId,
      page.url,
      page.screenshotPath,
      page.snapshotJson,
      '[]',
    );
    for (const issue of issues) {
      stmtInsertIssue.run(
        issue.id,
        page.id,
        issue.source,
        issue.rule,
        issue.severity,
        issue.selector,
        issue.html,
        issue.explanation ?? null,
        issue.altVerdict === undefined ? null : JSON.stringify(issue.altVerdict),
      );
    }
  },
);
