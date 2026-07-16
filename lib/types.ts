// Source of truth for all shared shapes (PRD §19). Never redeclare these locally.

export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export type ErrorKind =
  | 'UNREACHABLE'
  | 'LOGIN_WALL'
  | 'BOT_BLOCKED'
  | 'TIMEOUT'
  | 'UNSUPPORTED_CONTENT'
  | 'BLOCKED_PRIVATE_NETWORK'
  | 'INTERNAL';

export type AuditStatus =
  'queued' | 'loading' | 'crawling' | 'auditing' | 'narrating' | 'scoring' | 'done' | 'failed';

export interface AuditJob {
  id: string; // nanoid(10)
  url: string;
  crawl: boolean;
  status: AuditStatus;
  errorKind?: ErrorKind;
  progress: ProgressEvent[]; // append-only
  scoreBefore?: number; // 0–100
  scoreAfter?: number;
  createdAt: string; // ISO 8601
}

export interface ProgressEvent {
  at: string;
  step: string;
  detail?: string;
}

export interface PageResult {
  id: string;
  auditId: string;
  url: string;
  screenshotPath: string; // under SCREENSHOT_DIR
  issues: Issue[];
  utterances: Utterance[];
}

export interface Issue {
  id: string;
  pageId: string;
  source: 'axe' | 'keyboard' | 'headings' | 'alt-quality';
  rule: string; // axe rule id, or custom: see CUSTOM_RULES
  severity: Severity;
  selector: string;
  html: string; // outerHTML truncated to 2000 chars
  explanation?: string; // model-written, one sentence, user-impact framing
  altVerdict?: { score: 0 | 1 | 2 | 3 | 4 | 5; verdict: string; suggestedAlt: string };
}

export interface Utterance {
  index: number;
  text: string; // exactly what is spoken, e.g. "link, Read more"
  selector?: string;
  issueId?: string; // set when this utterance demonstrates an issue
}

export interface Fix {
  id: string;
  issueId: string;
  diff: string; // unified diff, before/after outerHTML
  patchedHtml: string;
  rationale: string; // one line
  applied: boolean;
}

/** Custom rule ids (PRD §19) — fixed, do not invent new ones. */
export const CUSTOM_RULES = [
  'kb-trap',
  'kb-invisible-focus',
  'kb-order-jump',
  'heading-skip',
  'heading-multiple-h1',
  'heading-empty',
  'alt-poor-quality',
] as const;

export type CustomRule = (typeof CUSTOM_RULES)[number];
