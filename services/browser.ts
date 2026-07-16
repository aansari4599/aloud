import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { chromium, errors as pwErrors, type Browser, type Page } from 'playwright';
import {
  NAV_TIMEOUT_MS,
  SCREENSHOT_DIR,
  SCREENSHOT_JPEG_QUALITY,
  SCREENSHOT_MAX_HEIGHT_PX,
  SPA_SETTLE_DELAY_MS,
  VIEWPORT,
} from '../lib/constants';
import { AppError } from '../lib/errors';
import { ssrfGuard, type SsrfOptions } from '../lib/ssrf';

/** A11y tree node as returned by page.accessibility.snapshot() (PRD §8.3 — pinned API). */
export type A11ySnapshot = NonNullable<Awaited<ReturnType<Page['accessibility']['snapshot']>>>;

export interface CapturedPage {
  html: string;
  screenshotPath: string;
  snapshot: A11ySnapshot | null;
}

let browserPromise: Promise<Browser> | null = null;

/** Launches (once) and returns the shared Chromium instance. */
function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true });
  return browserPromise;
}

/** Closes the shared browser. Scripts and shutdown paths only. */
export async function closeBrowser(): Promise<void> {
  if (browserPromise === null) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

/**
 * Runs `fn` against a live, ssrf-guarded, navigated page in a fresh context.
 * The context is always closed afterwards — callers never manage lifecycle.
 */
export async function withPage<T>(
  url: string,
  opts: SsrfOptions,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const safeUrl = await ssrfGuard(url, opts);
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: false });
  try {
    const page = await context.newPage();
    await guardRedirects(page, safeUrl);
    await navigate(page, safeUrl.href);
    return await fn(page);
  } finally {
    await context.close();
  }
}

/**
 * Extracts capture artifacts from an already-navigated page: rendered HTML, clipped
 * full-page JPEG screenshot, a11y snapshot. Writes the screenshot under SCREENSHOT_DIR.
 */
export async function captureFromPage(page: Page): Promise<CapturedPage> {
  const html = await page.content();
  const snapshot = await page.accessibility.snapshot();
  const screenshotPath = await takeScreenshot(page);
  return { html, screenshotPath, snapshot };
}

/**
 * Captures one page end-to-end: navigates (ssrf-guarded) then extracts artifacts.
 */
export async function capturePage(url: string, opts: SsrfOptions = {}): Promise<CapturedPage> {
  return withPage(url, opts, captureFromPage);
}

/** Re-checks ssrf on cross-origin top-frame navigations (redirect chains, ARCHITECTURE §10.4). */
async function guardRedirects(page: Page, original: URL): Promise<void> {
  if (original.protocol === 'file:') return;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) {
      return route.continue();
    }
    const targetHost = new URL(request.url()).hostname;
    if (targetHost === original.hostname) {
      return route.continue();
    }
    try {
      await ssrfGuard(request.url());
      return route.continue();
    } catch {
      return route.abort('blockedbyclient');
    }
  });
}

/** Navigates with the 15 s budget; a timeout with content rendered proceeds (partial audit beats TIMEOUT). */
async function navigate(page: Page, href: string): Promise<void> {
  try {
    await page.goto(href, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
  } catch (err) {
    if (!(err instanceof pwErrors.TimeoutError)) {
      throw new AppError('UNREACHABLE', `Navigation failed: ${href}`);
    }
    const rendered = await page
      .evaluate(() => document.body?.childElementCount ?? 0)
      .catch(() => 0);
    if (rendered === 0) {
      throw new AppError('TIMEOUT', `Nothing rendered within ${NAV_TIMEOUT_MS} ms: ${href}`);
    }
  }
  await page.waitForTimeout(SPA_SETTLE_DELAY_MS); // SPA settle (ARCHITECTURE §16)
}

/** Full-page JPEG clipped to SCREENSHOT_MAX_HEIGHT_PX. Writes under SCREENSHOT_DIR. */
async function takeScreenshot(page: Page): Promise<string> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = join(SCREENSHOT_DIR, `${nanoid(10)}.jpg`);
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const height = Math.min(Math.max(fullHeight, VIEWPORT.height), SCREENSHOT_MAX_HEIGHT_PX);
  await page.screenshot({
    path,
    type: 'jpeg',
    quality: SCREENSHOT_JPEG_QUALITY,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height },
  });
  return path;
}
