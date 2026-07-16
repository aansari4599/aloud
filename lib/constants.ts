// Every tunable lives here (AGENTS.md: no magic numbers at call sites).
// ARCHITECTURE §8 budgets reference these values.

import { dirname, join } from 'node:path';
import type { Severity } from './types';

// Playwright capture (ARCHITECTURE §8)
export const NAV_TIMEOUT_MS = 15_000;
export const VIEWPORT = { width: 1366, height: 900 } as const;
export const SCREENSHOT_MAX_HEIGHT_PX = 6_000;
export const SCREENSHOT_JPEG_QUALITY = 70;
export const SPA_SETTLE_DELAY_MS = 1_000; // after networkidle (ARCHITECTURE §16)

// Crawl (PRD §F1)
export const CRAWL_MAX_PAGES = 8;
export const ROBOTS_TIMEOUT_MS = 3_000;

// Concurrency (ARCHITECTURE §8)
export const JOB_CONCURRENCY = 2;
export const PAGES_IN_PARALLEL = 2;
export const VISION_MAX_PARALLEL = 4;
export const VISION_MAX_IMAGES_PER_PAGE = 20;

// Custom checks (PRD §21 T-A2.2)
export const KEYBOARD_TAB_COUNT = 50;
export const KB_TRAP_CYCLE_MAX_ELEMENTS = 3;
export const KB_TRAP_MIN_REPEATS = 3;
export const KB_ORDER_JUMP_PX = 200;

// Issues & explanations (PRD §19, §19.4)
export const HTML_TRUNCATE_CHARS = 2_000;
export const EXPLAIN_MAX_ISSUES = 30;

// AccessScore (PRD §11)
export const SCORE_WEIGHTS: Record<Severity, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};
export const SCORE_RULE_CAP = 30; // max deduction per rule type
export const GRADE_BANDS: ReadonlyArray<{ min: number; grade: string }> = [
  { min: 90, grade: 'A' },
  { min: 80, grade: 'B' },
  { min: 65, grade: 'C' },
  { min: 50, grade: 'D' },
  { min: 0, grade: 'F' },
];

// Client (PRD §8.1, §19.1)
export const POLL_INTERVAL_MS = 1_500;
export const CAPTION_FALLBACK_WPM = 160;
export const TEXT_CHUNK_MAX_WORDS = 12;

// Paths — /data in prod (Railway volume), ./data locally
export const DATABASE_PATH = process.env.DATABASE_PATH ?? './data/aloud.db';
export const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? './data/shots';
export const PATCHED_DIR = join(dirname(DATABASE_PATH), 'patched');
