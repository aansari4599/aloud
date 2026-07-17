import Link from 'next/link';
import type { ErrorKind } from '../lib/types';

interface CardCopy {
  icon: string;
  title: string;
  message: string;
}

// One designed card per ErrorKind (ARCHITECTURE §9). Never a stack trace.
const CARDS: Record<ErrorKind, CardCopy> = {
  BLOCKED_PRIVATE_NETWORK: {
    icon: '🔒',
    title: 'We only audit public sites',
    message: 'That address points at a private or internal network, which we never touch.',
  },
  UNREACHABLE: {
    icon: '🛰️',
    title: "We couldn't reach that URL",
    message: 'Check the spelling, or the site may be down. It happens to the best of us.',
  },
  TIMEOUT: {
    icon: '⏱️',
    title: 'The site took too long to load',
    message: 'We waited 15 seconds and nothing rendered. Try again — or try a faster page.',
  },
  LOGIN_WALL: {
    icon: '🚪',
    title: 'This page needs a login',
    message:
      'We can only audit what a logged-out visitor can see. Try a public page of the same site.',
  },
  BOT_BLOCKED: {
    icon: '🤖',
    title: "The site's bot protection blocked us",
    message:
      'Their firewall mistook our auditor for a scraper. Try a different site — or the gallery below.',
  },
  UNSUPPORTED_CONTENT: {
    icon: '📄',
    title: 'Point me at an HTML page',
    message: 'That URL serves a PDF, image, or other non-HTML content we cannot narrate.',
  },
  INTERNAL: {
    icon: '🔧',
    title: 'Something went wrong on our side',
    message: 'Not you — us. Try again in a moment, or explore a pre-audited site.',
  },
};

/** Friendly one-liner for inline form errors (same copy source as the cards). */
export function errorLine(kind: ErrorKind | undefined): string {
  const copy = CARDS[kind ?? 'INTERNAL'];
  return `${copy.title}. ${copy.message}`;
}

/** Friendly failure card with gallery escape hatch (PRD §F1). */
export function ErrorCard({ kind }: { kind: ErrorKind }) {
  const copy = CARDS[kind];
  return (
    <div className="w-full max-w-xl rounded-xl border border-surface-line bg-surface-raised p-8 text-center">
      <p aria-hidden className="text-4xl">
        {copy.icon}
      </p>
      <h2 className="mt-3 text-xl font-bold text-zinc-100">{copy.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{copy.message}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300"
        >
          Try another site
        </Link>
        <Link
          href="/#gallery-heading"
          className="rounded-lg border border-surface-line px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-accent/60"
        >
          Explore the gallery
        </Link>
      </div>
    </div>
  );
}
