import { dirname } from 'node:path';
import { CRAWL_MAX_PAGES, ROBOTS_TIMEOUT_MS } from '../lib/constants';
import type { SsrfOptions } from '../lib/ssrf';
import { withPage } from './browser';

const SKIP_PROTOCOLS = ['mailto:', 'tel:', 'javascript:'];
const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|svg|webp|ico|css|js|json|xml|zip|gz|tar|mp3|mp4|webm|avi|mov|woff2?|ttf|eot)$/i;

/** Same-origin for http(s); same-directory-or-below for file:// (fixtures). */
function sameSite(start: URL, target: URL): boolean {
  if (start.protocol === 'file:') {
    return (
      target.protocol === 'file:' && dirname(target.pathname).startsWith(dirname(start.pathname))
    );
  }
  return target.origin === start.origin;
}

/** Best-effort robots.txt: Disallow prefixes for `User-agent: *`. Any failure → no restrictions. */
async function fetchDisallows(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const disallows: string[] = [];
    let applies = false;
    for (const raw of (await res.text()).split('\n')) {
      const line = raw.trim();
      const sep = line.indexOf(':');
      if (sep === -1) continue;
      const key = line.slice(0, sep).toLowerCase();
      const value = line.slice(sep + 1).trim();
      if (key === 'user-agent') applies = value === '*';
      else if (applies && key === 'disallow' && value !== '') disallows.push(value);
    }
    return disallows;
  } catch {
    return [];
  }
}

/**
 * BFS over same-origin `<a href>` links, capped at CRAWL_MAX_PAGES. Navigates the browser
 * once per discovered page. Skips fragments (hash stripped), mailto/tel/javascript,
 * non-HTML file extensions, and robots.txt-disallowed paths. Returns visit-ordered URLs.
 */
export async function crawl(startUrl: string, ssrf: SsrfOptions = {}): Promise<string[]> {
  const start = new URL(startUrl);
  start.hash = '';
  const disallows = start.protocol === 'file:' ? [] : await fetchDisallows(start.origin);
  const isDisallowed = (target: URL): boolean =>
    disallows.some((prefix) => target.pathname.startsWith(prefix));

  const visited: string[] = [];
  const seen = new Set<string>([start.href]);
  const queue: string[] = [start.href];

  while (queue.length > 0 && visited.length < CRAWL_MAX_PAGES) {
    const current = queue.shift();
    if (current === undefined) break;
    visited.push(current);

    let hrefs: string[];
    try {
      // String expression: function callbacks break under Next's webpack minification.
      hrefs = await withPage(current, ssrf, (page) =>
        page.evaluate<string[]>(`Array.from(document.querySelectorAll('a[href]'), (a) => a.href)`),
      );
    } catch {
      continue; // page failed to load — it stays listed, its links are lost
    }

    for (const raw of hrefs) {
      let target: URL;
      try {
        target = new URL(raw);
      } catch {
        continue;
      }
      target.hash = '';
      if (SKIP_PROTOCOLS.includes(target.protocol)) continue;
      if (!sameSite(start, target)) continue;
      if (SKIP_EXTENSIONS.test(target.pathname)) continue;
      if (isDisallowed(target)) continue;
      if (seen.has(target.href)) continue;
      seen.add(target.href);
      queue.push(target.href);
    }
  }

  return visited;
}
