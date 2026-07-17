'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorCard } from '../../../components/ErrorCard';
import { IssueCard } from '../../../components/IssueCard';
import { ProgressLog } from '../../../components/ProgressLog';
import { POLL_INTERVAL_MS } from '../../../lib/constants';
import type { AuditJob, Issue, PageResult, Severity } from '../../../lib/types';

const SEVERITY_ORDER: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
const RUNNING = ['queued', 'loading', 'crawling', 'auditing', 'narrating', 'scoring'];

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
    <Shell>
      <p className="break-all text-sm text-zinc-500">{job.url}</p>

      {running && <ProgressLog events={job.progress} running />}

      {job.status === 'failed' && <ErrorCard kind={job.errorKind ?? 'INTERNAL'} />}

      {job.status === 'done' && pages !== undefined && <Results pages={pages} />}
    </Shell>
  );
}

function Results({ pages }: { pages: PageResult[] }) {
  const issues = pages.flatMap((p) => p.issues);
  const bySeverity = new Map<Severity, Issue[]>(
    SEVERITY_ORDER.map((s) => [s, issues.filter((i) => i.severity === s)]),
  );

  return (
    <div className="w-full">
      <div className="mb-8 flex flex-wrap gap-4">
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-6 px-6 py-12">
      <header className="flex w-full items-center gap-2">
        <Link href="/" className="flex items-center gap-2 text-zinc-200">
          <span aria-hidden className="text-accent">
            ●
          </span>
          <span className="font-semibold tracking-wide">Aloud</span>
        </Link>
      </header>
      {children}
    </main>
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
