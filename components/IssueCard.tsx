import type { Issue, Severity } from '../lib/types';

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-red-950 text-red-300 border-red-900',
  serious: 'bg-orange-950 text-orange-300 border-orange-900',
  moderate: 'bg-yellow-950 text-yellow-300 border-yellow-900',
  minor: 'bg-zinc-800 text-zinc-400 border-zinc-700',
};

// Rule-derived headlines (PRD §F4 fallback) — no raw axe jargon as the card title.
export const RULE_HEADLINES: Record<string, string> = {
  'image-alt': 'Image has no alt text',
  'alt-poor-quality': "Alt text doesn't describe the image",
  'image-redundant-alt': 'Alt text just says "image"',
  'button-name': 'Button has no label',
  label: 'Form field has no label',
  'color-contrast': 'Text is hard to read (low contrast)',
  'heading-order': 'Heading levels skip a step',
  'heading-multiple-h1': 'More than one main heading',
  'heading-empty': 'Empty heading',
  'kb-trap': 'Keyboard users get stuck here',
  'kb-invisible-focus': 'Keyboard focus is invisible here',
  'kb-order-jump': 'Tab order jumps around the page',
  'landmark-one-main': 'Page has no main content region',
  region: 'Content sits outside any landmark region',
  'document-title': 'Page has no title',
  'html-has-lang': 'Page language is not declared',
  'link-name': 'Link has no text',
};

/** Human headline for a rule id — falls back to a de-hyphenated version. Pure. */
export function headlineFor(rule: string): string {
  return RULE_HEADLINES[rule] ?? rule.replace(/-/g, ' ');
}

/** Issue card: plain-English headline + user-impact explanation; markup as evidence. */
export function IssueCard({ issue }: { issue: Issue }) {
  const verdict = issue.altVerdict;
  return (
    <li className="rounded-xl border border-surface-line bg-surface-raised p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${SEVERITY_STYLES[issue.severity]}`}
        >
          {issue.severity}
        </span>
        <h3 className="font-semibold text-zinc-100">{headlineFor(issue.rule)}</h3>
        <span className="font-mono text-xs text-zinc-600">{issue.rule}</span>
      </div>
      {issue.explanation !== undefined && issue.explanation !== '' && (
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">{issue.explanation}</p>
      )}
      {verdict !== undefined && (
        <p className="mt-2 text-sm text-zinc-400">
          <span className="text-zinc-500">Vision model:</span> {verdict.verdict}{' '}
          <span className="text-zinc-500">Suggested:</span>{' '}
          <span className="text-accent">“{verdict.suggestedAlt}”</span>
        </p>
      )}
      <p className="mt-3 break-all font-mono text-xs text-zinc-500">{issue.selector}</p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-zinc-400">
        {issue.html.slice(0, 300)}
      </pre>
    </li>
  );
}
