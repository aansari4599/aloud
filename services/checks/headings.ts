import { JSDOM } from 'jsdom';
import { nanoid } from 'nanoid';
import { HTML_TRUNCATE_CHARS } from '../../lib/constants';
import type { Issue } from '../../lib/types';

/**
 * Heading rules axe doesn't cover: multiple <h1>. (heading-skip and heading-empty are
 * already reported by axe's heading-order / empty-heading — duplicating them here would
 * double every card.) Pure function over captured HTML.
 */
export function headingChecks(html: string, pageId: string): Issue[] {
  const doc = new JSDOM(html).window.document;
  const h1s = [...doc.querySelectorAll('h1')];
  if (h1s.length <= 1) return [];
  const second = h1s[1];
  return [
    {
      id: nanoid(10),
      pageId,
      source: 'headings',
      rule: 'heading-multiple-h1',
      severity: 'moderate',
      selector: 'h1:nth-of-type(2)',
      html: second.outerHTML.slice(0, HTML_TRUNCATE_CHARS),
    },
  ];
}
