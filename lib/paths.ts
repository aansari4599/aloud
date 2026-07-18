// Filesystem paths — server-only (imports node:path).
// /data in prod (Railway volume), ./data locally.

import { dirname, join } from 'node:path';

export const DATABASE_PATH = process.env.DATABASE_PATH ?? './data/aloud.db';
export const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? './data/shots';
export const PATCHED_DIR = join(dirname(DATABASE_PATH), 'patched');
export const PAGE_HTML_DIR = join(dirname(DATABASE_PATH), 'pages');
