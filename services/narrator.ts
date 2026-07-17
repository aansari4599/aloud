import { JSDOM } from 'jsdom';
import { TEXT_CHUNK_MAX_WORDS } from '../lib/constants';
import type { Issue, Utterance } from '../lib/types';
import type { A11ySnapshot } from './browser';

// The single source of narration grammar (PRD §19.1). The ReplayPlayer renders verbatim.

const DIGIT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

/** "IMG_4723.jpg" → "I M G underscore four seven two three" (PRD §19.1 image row). */
export function spellFilename(src: string): string {
  const base = (src.split('/').pop() ?? src).replace(/\.[a-z0-9]+$/i, '');
  const out: string[] = [];
  for (const part of base.split(/([^a-zA-Z0-9]+)/)) {
    if (part === '') continue;
    if (/^[^a-zA-Z0-9]+$/.test(part)) {
      if (part.includes('_')) out.push('underscore');
      continue; // hyphens and dots read as pauses — dropped
    }
    for (const run of part.match(/[a-zA-Z]+|[0-9]+/g) ?? []) {
      if (/^[0-9]+$/.test(run)) {
        out.push(...[...run].map((d) => DIGIT_WORDS[Number(d)]));
      } else if (run === run.toUpperCase() && run.length <= 4) {
        out.push(...[...run]); // acronym-ish: IMG → I M G
      } else {
        out.push(run.toLowerCase());
      }
    }
  }
  return out.join(' ');
}

interface ImgInfo {
  src: string;
  alt: string | null; // null = attribute missing entirely
}

/** Document-ordered <img> list — the a11y tree prunes unnamed images, real screen readers don't. */
function collectImgs(html: string): ImgInfo[] {
  const doc = new JSDOM(html).window.document;
  return [...doc.querySelectorAll('img')].map((img) => ({
    src: img.getAttribute('src') ?? '',
    alt: img.getAttribute('alt'),
  }));
}

interface Draft {
  text: string;
  hint?: string; // linking hint: filename base, or a custom marker
}

/**
 * Walks the a11y snapshot and emits spoken text per the §19.1 grammar.
 * Unnamed images are interleaved from the HTML img list (document order).
 */
export function buildUtterances(
  snapshot: A11ySnapshot | null,
  html: string,
  issues: Issue[] = [],
): Utterance[] {
  const drafts: Draft[] = [];
  const imgQueue = collectImgs(html);

  /** Emits queued images that precede the next named one. Consumes the named head when told. */
  const drainImgs = (consumeNamed: boolean): void => {
    while (imgQueue.length > 0) {
      const head = imgQueue[0];
      if (head.alt === null) {
        imgQueue.shift();
        drafts.push({
          text: `image, ${spellFilename(head.src)}`,
          hint: imgHint(head.src),
        });
      } else if (head.alt === '') {
        imgQueue.shift(); // decorative — silence, like a real reader
      } else {
        if (consumeNamed) imgQueue.shift();
        return;
      }
    }
  };

  const pushText = (raw: string): void => {
    const words = raw.split(/\s+/).filter((w) => w !== '');
    for (let i = 0; i < words.length; i += TEXT_CHUNK_MAX_WORDS) {
      drafts.push({ text: words.slice(i, i + TEXT_CHUNK_MAX_WORDS).join(' ') });
    }
  };

  const visit = (node: A11ySnapshot): void => {
    const name = (node.name ?? '').trim();
    switch (node.role) {
      case 'link':
        if (name !== '') drafts.push({ text: `link, ${name}` });
        return;
      case 'button':
        drafts.push(
          name !== ''
            ? { text: `button, ${name}` }
            : { text: 'button, unlabeled', hint: 'button-unlabeled' },
        );
        return;
      case 'image':
      case 'img':
        drainImgs(true);
        if (name !== '') drafts.push({ text: `image, ${name}`, hint: 'image-named' });
        return;
      case 'heading':
        drafts.push({
          text: `heading level ${node.level ?? 2}, ${name}`,
          hint: `heading:${name}`,
        });
        return;
      case 'textbox':
        drafts.push({
          text: `edit text, ${name !== '' ? name : 'unlabeled'}${node.required === true ? ', required' : ''}`,
          ...(name === '' ? { hint: 'textbox-unlabeled' } : {}),
        });
        return;
      case 'navigation':
        drafts.push({ text: 'navigation region' });
        break; // landmarks announce, then their contents are read
      case 'text':
        if (name !== '') pushText(name);
        return;
      default:
        break; // containers: recurse below
    }
    for (const child of node.children ?? []) visit(child as A11ySnapshot);
  };

  if (snapshot !== null) visit(snapshot);
  drainImgs(false); // trailing unnamed images

  return link(drafts, issues);
}

const imgHint = (src: string): string => `img:${(src.split('/').pop() ?? src).split('.')[0]}`;

/** Attaches issueId + selector where an utterance demonstrably corresponds to an issue. */
function link(drafts: Draft[], issues: Issue[]): Utterance[] {
  const claimed = new Set<string>();

  const claim = (predicate: (i: Issue) => boolean): Issue | undefined => {
    const found = issues.find((i) => !claimed.has(i.id) && predicate(i));
    if (found) claimed.add(found.id);
    return found;
  };

  return drafts.map((draft, index) => {
    let issue: Issue | undefined;
    if (draft.hint === 'button-unlabeled') {
      issue = claim((i) => i.rule === 'button-name');
    } else if (draft.hint === 'textbox-unlabeled') {
      issue = claim((i) => i.rule === 'label');
    } else if (draft.hint === 'image-named') {
      issue = claim((i) => i.rule === 'alt-poor-quality' || i.rule === 'image-redundant-alt');
    } else if (draft.hint?.startsWith('img:')) {
      const base = draft.hint.slice(4);
      issue = claim(
        (i) => i.rule === 'image-alt' && (i.selector.includes(base) || i.html.includes(base)),
      );
    } else if (draft.hint?.startsWith('heading:')) {
      const headingName = draft.hint.slice(8);
      issue = claim(
        (i) =>
          (i.rule === 'heading-order' || i.rule.startsWith('heading-')) &&
          headingName !== '' &&
          i.html.includes(headingName),
      );
    }
    return {
      index,
      text: draft.text,
      ...(issue === undefined ? {} : { issueId: issue.id, selector: issue.selector }),
    };
  });
}
