import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { DATABASE_PATH } from './constants';

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
