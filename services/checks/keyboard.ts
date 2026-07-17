import { nanoid } from 'nanoid';
import type { Page } from 'playwright';
import {
  HTML_TRUNCATE_CHARS,
  KB_ORDER_JUMP_PX,
  KB_TRAP_CYCLE_MAX_ELEMENTS,
  KB_TRAP_MIN_REPEATS,
  KEYBOARD_TAB_COUNT,
} from '../../lib/constants';
import type { Issue } from '../../lib/types';

interface FocusStop {
  selector: string;
  y: number;
  visibleFocus: boolean;
  html: string;
}

// One expression per Tab stop. String form: function callbacks break under Next's webpack
// minification (see services/browser.ts).
const FOCUS_INFO_EXPR = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const sel = (node) => {
    if (node.id) return '#' + node.id;
    const parts = [];
    let cur = node;
    while (cur && cur.tagName && cur !== document.body) {
      let p = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        p += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(p);
      cur = parent;
      if (cur && cur.id) { parts.unshift('#' + cur.id); break; }
    }
    return parts.join(' > ');
  };
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    selector: sel(el),
    y: rect.top + window.scrollY,
    visibleFocus: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none',
    html: el.outerHTML,
  };
})()`;

/** Detects a tail cycle of ≤ maxLen distinct elements repeating ≥ minRepeats times. */
function findTrapCycle(path: string[], maxLen: number, minRepeats: number): string[] | null {
  for (let len = 1; len <= maxLen; len += 1) {
    if (path.length < len * minRepeats) continue;
    const cycle = path.slice(-len);
    let repeats = 0;
    for (let end = path.length; end - len >= 0; end -= len) {
      const window = path.slice(end - len, end);
      if (window.join('|') === cycle.join('|')) repeats += 1;
      else break;
    }
    if (repeats >= minRepeats && new Set(cycle).size === cycle.length) return cycle;
  }
  return null;
}

/**
 * Tabs through the page KEYBOARD_TAB_COUNT times recording the focus path, then emits
 * kb-trap / kb-invisible-focus / kb-order-jump issues (PRD §19 custom rules).
 * Navigates browser focus state.
 */
export async function keyboardWalk(page: Page, pageId: string): Promise<Issue[]> {
  const stops: FocusStop[] = [];
  for (let i = 0; i < KEYBOARD_TAB_COUNT; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate<FocusStop | null>(FOCUS_INFO_EXPR).catch(() => null);
    if (info === null) continue;
    stops.push(info);
  }
  if (stops.length === 0) return [];

  const issues: Issue[] = [];
  const mkIssue = (rule: Issue['rule'], severity: Issue['severity'], stop: FocusStop): Issue => ({
    id: nanoid(10),
    pageId,
    source: 'keyboard',
    rule,
    severity,
    selector: stop.selector,
    html: stop.html.slice(0, HTML_TRUNCATE_CHARS),
  });

  // kb-trap: focus cycles inside a small widget and never escapes. A cycle spanning ALL
  // focusables is just a small page wrapping around — only a strict subset is a trap.
  const path = stops.map((s) => s.selector);
  const distinctFocusables = new Set(path).size;
  let cycle = findTrapCycle(path, KB_TRAP_CYCLE_MAX_ELEMENTS, KB_TRAP_MIN_REPEATS);
  if (cycle !== null && cycle.length >= distinctFocusables) cycle = null;
  const trapMembers = new Set(cycle ?? []);
  if (cycle !== null) {
    const first = stops.find((s) => s.selector === cycle[0]);
    if (first !== undefined) issues.push(mkIssue('kb-trap', 'critical', first));
  }

  // kb-invisible-focus: no outline and no box-shadow while focused (trap members excluded —
  // script-driven focus suppresses :focus-visible and would double-report the trap).
  const invisibleSeen = new Set<string>();
  for (const stop of stops) {
    if (stop.visibleFocus || trapMembers.has(stop.selector) || invisibleSeen.has(stop.selector)) {
      continue;
    }
    invisibleSeen.add(stop.selector);
    issues.push(mkIssue('kb-invisible-focus', 'serious', stop));
  }

  // kb-order-jump: focus leaps upward against document order. Wrap-around back to the
  // first focusable is normal tab behavior, not a defect.
  const firstSelector = stops[0].selector;
  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1];
    const cur = stops[i];
    if (cur.selector === firstSelector) continue;
    if (trapMembers.has(cur.selector) || trapMembers.has(prev.selector)) continue;
    if (prev.y - cur.y > KB_ORDER_JUMP_PX) {
      issues.push(mkIssue('kb-order-jump', 'moderate', cur));
      break; // one report per page is enough signal
    }
  }

  return issues;
}
