'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ErrorKind } from '../lib/types';
import { errorLine } from './ErrorCard';

/** Landing URL form: POST /api/audits → redirect to /a/[id]. Calls the API. */
export function AuditForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized, crawl }),
      });
      const body = (await res.json()) as {
        id?: string;
        error?: { kind?: ErrorKind; message: string };
      };
      if (!res.ok || !body.id) {
        setError(errorLine(body.error?.kind));
        setBusy(false);
        return;
      }
      router.push(`/a/${body.id}`);
    } catch {
      setError('Could not reach the server. Try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-xl">
      <label htmlFor="url" className="sr-only">
        Website URL to audit
      </label>
      <div className="flex gap-2 rounded-xl border border-surface-line bg-surface-raised p-2 focus-within:border-accent/60">
        <input
          id="url"
          name="url"
          type="text"
          required
          autoComplete="url"
          placeholder="yoursite.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-5 py-2 text-lg font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Hear it'}
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-zinc-400">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={crawl}
            onChange={(e) => setCrawl(e.target.checked)}
            className="h-4 w-4 accent-amber-400"
          />
          Crawl up to 8 pages
        </label>
        <span>Free · no signup</span>
      </div>
      {error !== null && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}
    </form>
  );
}
