import type { Issue, Severity } from '../lib/types';

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-red-950 text-red-300 border-red-900',
  serious: 'bg-orange-950 text-orange-300 border-orange-900',
  moderate: 'bg-yellow-950 text-yellow-300 border-yellow-900',
  minor: 'bg-zinc-800 text-zinc-400 border-zinc-700',
};

/** Basic issue card: rule headline, severity chip, selector + offending markup. */
export function IssueCard({ issue }: { issue: Issue }) {
  return (
    <li className="rounded-xl border border-surface-line bg-surface-raised p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${SEVERITY_STYLES[issue.severity]}`}
        >
          {issue.severity}
        </span>
        <h3 className="font-semibold text-zinc-100">{issue.rule}</h3>
      </div>
      {issue.explanation !== undefined && (
        <p className="mt-2 text-sm text-zinc-300">{issue.explanation}</p>
      )}
      <p className="mt-3 break-all font-mono text-xs text-zinc-500">{issue.selector}</p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-zinc-400">
        {issue.html.slice(0, 300)}
      </pre>
    </li>
  );
}
