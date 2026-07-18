'use client';

import { useState } from 'react';
import type { Fix, Issue } from '../lib/types';

function DiffLines({ diff }: { diff: string }) {
  const lines = diff
    .split('\n')
    .filter((l) => !/^(===|---|\+\+\+|Index:)/.test(l) && l !== '\\ No newline at end of file');
  return (
    <pre className="overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith('+')
              ? 'bg-emerald-950/60 text-emerald-300'
              : line.startsWith('-')
                ? 'bg-red-950/60 text-red-300'
                : line.startsWith('@@')
                  ? 'text-zinc-600'
                  : 'text-zinc-400'
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

/** One fix: rule headline, rationale, colorized unified diff, copy button. */
export function DiffViewer({ fix, issue }: { fix: Fix; issue: Issue | undefined }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(fix.patchedHtml);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions) — button just doesn't confirm
    }
  }

  return (
    <li className="rounded-xl border border-surface-line bg-surface-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-zinc-100">{issue?.rule ?? 'fix'}</h3>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-lg border border-surface-line px-3 py-1 text-xs font-semibold text-zinc-300 hover:border-accent/60"
        >
          {copied ? 'Copied ✓' : 'Copy fixed HTML'}
        </button>
      </div>
      <p className="mt-1 text-sm text-zinc-400">{fix.rationale}</p>
      {issue !== undefined && (
        <p className="mt-1 break-all font-mono text-xs text-zinc-600">{issue.selector}</p>
      )}
      <div className="mt-3">
        <DiffLines diff={fix.diff} />
      </div>
    </li>
  );
}
