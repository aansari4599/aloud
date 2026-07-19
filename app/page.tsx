import Link from 'next/link';
import { AuditForm } from '../components/AuditForm';
import { GALLERY_SITES, GRADE_BANDS } from '../lib/constants';
import { findLatestAuditByUrlPattern, getRecentAudits } from '../lib/db';

// Gallery reads the local db — fresh on every request, works with no external network.
export const dynamic = 'force-dynamic';

const gradeFor = (score: number): string => GRADE_BANDS.find((b) => score >= b.min)?.grade ?? 'F';

const scoreColor = (score: number): string => {
  if (score >= 90) return 'text-emerald-400';
  if (score >= 65) return 'text-accent';
  if (score >= 50) return 'text-orange-400';
  return 'text-red-400';
};

const hostOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.protocol === 'file:'
      ? (u.pathname.split('/').slice(-2).join('/') ?? url)
      : u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
};

function RecentAudits() {
  const recent = getRecentAudits(6);
  if (recent.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading" className="pb-8 pt-2">
      <h2
        id="recent-heading"
        className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500"
      >
        Recent audits
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map((a) => (
          <li key={a.id}>
            <Link
              href={`/a/${a.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-surface-line bg-surface-raised/60 px-4 py-3 transition hover:border-accent/60"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{hostOf(a.url)}</span>
              <span className={`font-mono text-lg font-bold ${scoreColor(a.scoreBefore)}`}>
                {a.scoreBefore}
              </span>
              <span className="text-xs uppercase text-zinc-500">{gradeFor(a.scoreBefore)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-16">
      <header className="flex items-center gap-2 text-zinc-400">
        <span aria-hidden className="text-accent">
          ●
        </span>
        <span className="font-semibold tracking-wide text-zinc-200">Aloud</span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-8 py-20 text-center">
        <h1 className="max-w-3xl text-5xl font-extrabold leading-tight tracking-tightest text-zinc-50 sm:text-6xl">
          Hear your website the way <span className="text-accent">1&nbsp;in&nbsp;6</span> users
          experience it.
        </h1>
        <p className="max-w-xl text-lg text-zinc-400">
          Aloud plays your page back as a blind user hears it, shows it as low-vision users see it —
          then writes the fixes and opens the pull request.
        </p>
        <AuditForm />
      </section>

      <section aria-labelledby="gallery-heading" className="pb-8">
        <h2
          id="gallery-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500"
        >
          Or explore a pre-audited site
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {GALLERY_SITES.map((site) => {
            const audit = findLatestAuditByUrlPattern(site.match);
            if (audit === undefined || audit.scoreBefore === null) {
              return (
                <li
                  key={site.name}
                  className="rounded-xl border border-dashed border-surface-line bg-surface-raised/50 p-5"
                >
                  <p className="font-semibold text-zinc-300">{site.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">Pre-audited example — coming soon</p>
                </li>
              );
            }
            return (
              <li key={site.name}>
                <Link
                  href={`/r/${audit.id}`}
                  className="block rounded-xl border border-surface-line bg-surface-raised p-5 transition hover:border-accent/60"
                >
                  <p className="text-3xl font-extrabold text-accent">
                    {audit.scoreBefore}
                    <span className="ml-2 text-sm font-semibold uppercase text-zinc-500">
                      grade {gradeFor(audit.scoreBefore)}
                    </span>
                  </p>
                  <p className="mt-2 font-semibold text-zinc-300">{site.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">View the full report →</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <RecentAudits />

      <p className="pb-8 text-center text-xs text-zinc-600">
        AccessScore is a heuristic, not a WCAG certification.
      </p>
    </main>
  );
}
