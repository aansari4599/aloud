import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IssueCard } from '../../../components/IssueCard';
import { ScoreDial } from '../../../components/ScoreDial';
import { getAuditJob, getPages } from '../../../lib/db';
import type { Severity } from '../../../lib/types';

export const dynamic = 'force-dynamic';

const SEVERITY_ORDER: Severity[] = ['critical', 'serious', 'moderate', 'minor'];

const hostOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' ? (u.pathname.split('/').pop() ?? url) : u.hostname;
  } catch {
    return url;
  }
};

/** OG card: the score travels in the title (PRD §F8). */
export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const job = getAuditJob(params.id);
  if (!job || job.status !== 'done') return { title: 'Aloud — accessibility report' };
  const score = job.scoreAfter ?? job.scoreBefore;
  const title = `${hostOf(job.url)} scores ${score ?? '—'}/100 on Aloud`;
  const description =
    'Hear this website the way 1 in 6 users experience it — screen-reader replay, vision simulations, and AI-generated fixes.';
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

/** Public shareable report — server-rendered, read-only, no auth (PRD §19.2). Reads db. */
export default function ReportPage({ params }: { params: { id: string } }) {
  const job = getAuditJob(params.id);
  if (!job || job.status !== 'done') notFound();

  const pages = getPages(job.id);
  const issues = pages.flatMap((p) => p.issues);
  const firstPage = pages[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-8 px-6 py-12">
      <header className="flex w-full items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-zinc-200">
          <span aria-hidden className="text-accent">
            ●
          </span>
          <span className="font-semibold tracking-wide">Aloud</span>
        </Link>
        <Link
          href="/"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
        >
          Audit your site
        </Link>
      </header>

      <p className="break-all text-sm text-zinc-500">{job.url}</p>

      {job.scoreBefore !== undefined && (
        <ScoreDial before={job.scoreBefore} after={job.scoreAfter} />
      )}

      <div className="flex flex-wrap justify-center gap-4">
        {SEVERITY_ORDER.map((s) => {
          const count = issues.filter((i) => i.severity === s).length;
          return (
            <div
              key={s}
              className="rounded-xl border border-surface-line bg-surface-raised px-5 py-3 text-center"
            >
              <p className="text-2xl font-bold text-zinc-100">{count}</p>
              <p className="text-xs uppercase tracking-wide text-zinc-500">{s}</p>
            </div>
          );
        })}
      </div>

      {firstPage !== undefined && (
        <section aria-label="Page screenshot" className="w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- runtime screenshot */}
          <img
            src={`/api/screenshots/${firstPage.id}`}
            alt={`Screenshot of ${job.url}`}
            className="max-h-80 w-full rounded-xl border border-surface-line object-cover object-top"
          />
        </section>
      )}

      <section aria-label="Issues" className="w-full">
        {SEVERITY_ORDER.map((s) => {
          const group = issues.filter((i) => i.severity === s);
          if (group.length === 0) return null;
          return (
            <div key={s} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                {s} · {group.length}
              </h2>
              <ul className="space-y-3">
                {group.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </ul>
            </div>
          );
        })}
        {issues.length === 0 && (
          <p className="text-center text-zinc-300">No issues found by the automated checks. 🎉</p>
        )}
      </section>

      <footer className="pb-4 text-xs text-zinc-600">
        AccessScore is a heuristic, not a WCAG certification ·{' '}
        <Link href="/" className="text-accent hover:underline">
          made with Aloud
        </Link>
      </footer>
    </main>
  );
}
