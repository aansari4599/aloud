'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorCard } from '../../../components/ErrorCard';
import { FixesPanel } from '../../../components/FixesPanel';
import { IssueCard, headlineFor } from '../../../components/IssueCard';
import { ProgressLog } from '../../../components/ProgressLog';
import { ReplayPlayer } from '../../../components/ReplayPlayer';
import { ScoreDial } from '../../../components/ScoreDial';
import { VisionSim } from '../../../components/VisionSim';
import { POLL_INTERVAL_MS } from '../../../lib/constants';
import type { AuditJob, Issue, PageResult, Severity } from '../../../lib/types';

const SEVERITY_ORDER: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
const RUNNING = ['queued', 'loading', 'crawling', 'auditing', 'narrating', 'scoring'];

// Friendly labels for the global status bar, in pipeline order.
const STAGES: { key: string; label: string }[] = [
  { key: 'queued', label: 'Waiting in queue…' },
  { key: 'loading', label: 'Loading the page…' },
  { key: 'crawling', label: 'Finding more pages…' },
  { key: 'auditing', label: 'Running accessibility checks…' },
  { key: 'narrating', label: 'Listening like a screen reader…' },
  { key: 'scoring', label: 'Adding up the score…' },
];

/** Sticky top bar: which stage the audit is in, with overall progress. */
function StatusBar({ status }: { status: string }) {
  const idx = Math.max(
    0,
    STAGES.findIndex((s) => s.key === status),
  );
  const stage = STAGES[idx];
  const pct = Math.round(((idx + 1) / (STAGES.length + 1)) * 100);
  return (
    <div className="sticky top-0 z-10 w-full border-b border-surface-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-2.5">
        <span aria-hidden className="animate-pulse text-accent">
          ●
        </span>
        <span className="flex-1 text-sm text-zinc-300" aria-live="polite">
          {stage.label}
        </span>
        <span className="font-mono text-xs text-zinc-500">
          step {idx + 1} of {STAGES.length}
        </span>
      </div>
      <div className="h-0.5 bg-surface-line">
        <div className="h-0.5 bg-accent transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface AuditPayload {
  job: AuditJob;
  pages?: PageResult[];
}

/** Results shell: polls GET /api/audits/:id every 1.5 s until done/failed. */
export default function AuditPage({ params }: { params: { id: string } }) {
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  const [notFound, setNotFound] = useState(false);
  const signature = useRef('');

  useEffect(() => {
    let stopped = false;

    async function poll(): Promise<void> {
      try {
        const res = await fetch(`/api/audits/${params.id}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const body = (await res.json()) as AuditPayload;
        if (stopped) return;
        // Skip setState when nothing changed (AGENTS.md React rules).
        const sig = `${body.job.status}:${body.job.progress.length}:${body.pages?.length ?? 0}`;
        if (sig !== signature.current) {
          signature.current = sig;
          setPayload(body);
        }
      } catch {
        // transient network error — next tick retries
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [params.id]);

  if (notFound) {
    return (
      <Shell>
        <p className="text-zinc-300">No audit with this id.</p>
        <BackHome />
      </Shell>
    );
  }
  if (payload === null) {
    return (
      <Shell>
        <p className="animate-pulse text-zinc-400">Loading audit…</p>
      </Shell>
    );
  }

  const { job, pages } = payload;
  const running = RUNNING.includes(job.status);

  return (
    <Shell statusBar={running ? <StatusBar status={job.status} /> : undefined}>
      <p className="break-all text-sm text-zinc-500">{job.url}</p>

      {running && <ProgressLog events={job.progress} running />}

      {job.status === 'failed' && <ErrorCard kind={job.errorKind ?? 'INTERNAL'} />}

      {job.status === 'done' && pages !== undefined && (
        <Results
          pages={pages}
          scoreBefore={job.scoreBefore}
          scoreAfter={job.scoreAfter}
          auditId={job.id}
          siteUrl={job.url}
        />
      )}
    </Shell>
  );
}

function Results({
  pages,
  scoreBefore,
  scoreAfter,
  auditId,
  siteUrl,
}: {
  pages: PageResult[];
  scoreBefore?: number;
  scoreAfter?: number;
  auditId: string;
  siteUrl: string;
}) {
  const issues = pages.flatMap((p) => p.issues);
  const bySeverity = new Map<Severity, Issue[]>(
    SEVERITY_ORDER.map((s) => [s, issues.filter((i) => i.severity === s)]),
  );
  const narrated = pages.find((p) => p.utterances.length > 0);

  return (
    <div className="w-full">
      {scoreBefore !== undefined && (
        <div className="mb-10 flex justify-center">
          <ScoreDial before={scoreBefore} after={scoreAfter} />
        </div>
      )}
      {narrated !== undefined && (
        <section aria-labelledby="hear-it" className="mb-8">
          <h2
            id="hear-it"
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500"
          >
            Hear it
          </h2>
          <ReplayPlayer utterances={narrated.utterances} />
        </section>
      )}

      {pages[0] !== undefined && (
        <section aria-labelledby="see-it" className="mb-8">
          <h2
            id="see-it"
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500"
          >
            See it
          </h2>
          <VisionSim src={`/api/screenshots/${pages[0].id}`} siteUrl={pages[0].url} />
        </section>
      )}

      <section aria-labelledby="fix-it" className="mb-8">
        <h2
          id="fix-it"
          className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500"
        >
          Fix it
        </h2>
        <FixesPanel auditId={auditId} pages={pages} scoreBefore={scoreBefore} siteUrl={siteUrl} />
      </section>

      <div className="mb-4 flex flex-wrap gap-4">
        {SEVERITY_ORDER.map((s) => (
          <div
            key={s}
            className="rounded-xl border border-surface-line bg-surface-raised px-5 py-3"
          >
            <p className="text-2xl font-bold text-zinc-100">{bySeverity.get(s)?.length ?? 0}</p>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{s}</p>
          </div>
        ))}
        <div className="rounded-xl border border-surface-line bg-surface-raised px-5 py-3">
          <p className="text-2xl font-bold text-zinc-100">{pages.length}</p>
          <p className="text-xs uppercase tracking-wide text-zinc-500">pages</p>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {[
          ...issues.reduce(
            (m, i) => m.set(i.rule, (m.get(i.rule) ?? 0) + 1),
            new Map<string, number>(),
          ),
        ]
          .sort((a, b) => b[1] - a[1])
          .map(([rule, count]) => (
            <span
              key={rule}
              className="rounded-full border border-surface-line px-3 py-1 text-xs text-zinc-400"
            >
              {headlineFor(rule)} <span className="font-bold text-zinc-200">× {count}</span>
            </span>
          ))}
      </div>

      {SEVERITY_ORDER.map((s) => {
        const group = bySeverity.get(s) ?? [];
        if (group.length === 0) return null;
        return (
          <section key={s} aria-labelledby={`sev-${s}`} className="mb-8">
            <h2
              id={`sev-${s}`}
              className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500"
            >
              {s} · {group.length}
            </h2>
            <ul className="space-y-3">
              {group.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </ul>
          </section>
        );
      })}

      {issues.length === 0 && (
        <p className="text-zinc-300">No issues found by the automated checks. 🎉</p>
      )}
    </div>
  );
}

function Shell({
  children,
  statusBar,
}: {
  children: React.ReactNode;
  statusBar?: React.ReactNode;
}) {
  return (
    <>
      {statusBar}
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-6 px-6 py-12">
        <header className="flex w-full items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-zinc-200">
            <span aria-hidden className="text-accent">
              ●
            </span>
            <span className="font-semibold tracking-wide">Aloud</span>
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-surface-line px-4 py-2 text-sm font-semibold text-zinc-300 hover:border-accent/60"
          >
            ← New audit
          </Link>
        </header>
        {children}
      </main>
    </>
  );
}

function BackHome() {
  return (
    <Link
      href="/"
      className="mt-3 inline-block text-sm text-accent underline-offset-4 hover:underline"
    >
      ← Audit another site
    </Link>
  );
}
