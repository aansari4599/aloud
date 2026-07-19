// Every tunable lives here (AGENTS.md: no magic numbers at call sites).
// ARCHITECTURE §8 budgets reference these values.
// Client-importable: no node builtins — filesystem paths live in lib/paths.ts.

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

// Gallery (PRD §F8) — landing shows the latest done audit matching each pattern.
// Patterns are SQL LIKE; no trailing % anchors the match to the end of the URL.
export const GALLERY_SITES: ReadonlyArray<{ name: string; match: string }> = [
  { name: 'Sunrise Bakery — demo site (broken)', match: '%aloud-demo-site/' },
  { name: 'Sunrise Bakery — demo site (fixed)', match: '%aloud-demo-site/fixed/' },
  { name: 'example.com', match: 'https://example.com%' },
];

// Client (PRD §8.1, §19.1)
export const POLL_INTERVAL_MS = 1_500;
export const CAPTION_FALLBACK_WPM = 160;
export const TEXT_CHUNK_MAX_WORDS = 12;
