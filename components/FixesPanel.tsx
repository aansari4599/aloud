'use client';

import { useState } from 'react';
import type { Fix, Issue, PageResult } from '../lib/types';
import { DiffViewer } from './DiffViewer';
import { ReplayPlayer } from './ReplayPlayer';
import { ScoreDial } from './ScoreDial';

interface RerunPayload {
  scoreBefore: number;
  scoreAfter: number;
  pages: PageResult[];
}

type Phase = 'idle' | 'generating' | 'generated' | 'rerunning' | 'done';

const FIXABLE_RULES = new Set([
  'image-alt',
  'alt-poor-quality',
  'button-name',
  'label',
  'heading-order',
]);

function PrButton({
  eligible,
  busy,
  url,
  onClick,
}: {
  eligible: boolean;
  busy: boolean;
  url: string | null;
  onClick: () => void;
}) {
  if (url !== null) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        data-testid="pr-link"
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-emerald-400"
      >
        View PR ↗
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled={!eligible || busy}
      onClick={onClick}
      data-testid="open-pr"
      title={
        eligible
          ? 'Open a pull request with these fixes on the demo repo'
          : 'PR flow runs against the demo repo — paste diffs into your own codebase'
      }
      className="rounded-lg border border-surface-line px-4 py-2 text-sm font-semibold text-zinc-300 hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? 'Opening PR…' : 'Open PR'}
    </button>
  );
}

/** The agent loop UI: Fix with AI → diffs → apply & re-audit → before/after. Calls the API. */
export function FixesPanel({
  auditId,
  pages,
  scoreBefore,
  siteUrl,
}: {
  auditId: string;
  pages: PageResult[];
  scoreBefore?: number;
  siteUrl: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [after, setAfter] = useState<RerunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prBusy, setPrBusy] = useState(false);

  const issues = pages.flatMap((p) => p.issues);
  const issueById = new Map<string, Issue>(issues.map((i) => [i.id, i]));
  const fixableCount = issues.filter((i) => FIXABLE_RULES.has(i.rule)).length;
  const manualCount = issues.length - fixableCount;
  // PR flow works against the demo repo only (ADR-8); everything else ships diffs.
  const prEligible = /aloud-demo|fixtures/.test(siteUrl);

  async function generate(): Promise<void> {
    setPhase('generating');
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/fixes`, { method: 'POST' });
      const body = (await res.json()) as { fixes?: Fix[]; error?: { message: string } };
      if (!res.ok || body.fixes === undefined) {
        setError(body.error?.message ?? 'Fix generation failed — try again.');
        setPhase('idle');
        return;
      }
      setFixes(body.fixes);
      setPhase('generated');
    } catch {
      setError('Could not reach the server.');
      setPhase('idle');
    }
  }

  async function applyAndRerun(): Promise<void> {
    setPhase('rerunning');
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/rerun`, { method: 'POST' });
      const body = (await res.json()) as Partial<RerunPayload> & { error?: { message: string } };
      if (!res.ok || body.scoreAfter === undefined) {
        setError(body.error?.message ?? 'Re-audit failed — try again.');
        setPhase('generated');
        return;
      }
      setAfter(body as RerunPayload);
      setPhase('done');
    } catch {
      setError('Could not reach the server.');
      setPhase('generated');
    }
  }

  async function openPr(): Promise<void> {
    setPrBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/pr`, { method: 'POST' });
      const body = (await res.json()) as { prUrl?: string; error?: { message: string } };
      if (!res.ok || body.prUrl === undefined) {
        setError(body.error?.message ?? 'PR creation failed.');
      } else {
        setPrUrl(body.prUrl);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPrBusy(false);
    }
  }

  if (fixableCount === 0) {
    return <p className="text-sm text-zinc-500">No auto-fixable issues on this audit.</p>;
  }

  return (
    <div className="w-full">
      {phase === 'idle' && (
        <div className="rounded-2xl border border-surface-line bg-surface-raised p-8 text-center">
          <p className="text-lg text-zinc-200">
            {fixableCount} of {issues.length} issues are auto-fixable.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {manualCount > 0 ? `${manualCount} need a human (marked manual).` : 'All of them.'}
          </p>
          <button
            type="button"
            onClick={() => void generate()}
            data-testid="fix-with-ai"
            className="mt-5 rounded-xl bg-accent px-6 py-3 text-lg font-bold text-zinc-950 hover:bg-amber-300"
          >
            ✨ Fix with AI
          </button>
        </div>
      )}

      {phase === 'generating' && (
        <p className="animate-pulse text-center text-zinc-400">
          Writing fixes… (model calls are cached, repeat runs are instant)
        </p>
      )}

      {(phase === 'generated' || phase === 'rerunning') && (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-zinc-200">
              <span className="font-bold text-accent">{fixes.length}</span> fixes generated
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void applyAndRerun()}
                disabled={phase === 'rerunning'}
                data-testid="apply-rerun"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
              >
                {phase === 'rerunning' ? 'Re-auditing…' : 'Apply all & re-audit'}
              </button>
              <PrButton
                eligible={prEligible}
                busy={prBusy}
                url={prUrl}
                onClick={() => void openPr()}
              />
            </div>
          </div>
          <ul className="space-y-4">
            {fixes.map((f) => (
              <DiffViewer key={f.id} fix={f} issue={issueById.get(f.issueId)} />
            ))}
          </ul>
        </div>
      )}

      {phase === 'done' && after !== null && (
        <div className="flex flex-col items-center gap-8">
          <ScoreDial before={after.scoreBefore} after={after.scoreAfter} />
          <PrButton eligible={prEligible} busy={prBusy} url={prUrl} onClick={() => void openPr()} />
          {after.pages[0] !== undefined && after.pages[0].utterances.length > 0 && (
            <section aria-labelledby="fixed-narration" className="w-full">
              <h3
                id="fixed-narration"
                className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500"
              >
                What good sounds like
              </h3>
              <ReplayPlayer utterances={after.pages[0].utterances} />
            </section>
          )}
          <p className="text-sm text-zinc-400">
            {after.pages.flatMap((p) => p.issues).length} issues remain (not auto-fixable — see the
            report for details).
          </p>
        </div>
      )}

      {error !== null && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
