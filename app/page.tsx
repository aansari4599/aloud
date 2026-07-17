import { AuditForm } from '../components/AuditForm';

const GALLERY_PLACEHOLDERS = [
  { name: 'Government portal', note: 'Pre-audited example — coming with the gallery' },
  { name: 'News site', note: 'Pre-audited example — coming with the gallery' },
  { name: 'E-commerce store', note: 'Pre-audited example — coming with the gallery' },
];

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
          {GALLERY_PLACEHOLDERS.map((g) => (
            <li
              key={g.name}
              className="rounded-xl border border-dashed border-surface-line bg-surface-raised/50 p-5"
            >
              <p className="font-semibold text-zinc-300">{g.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{g.note}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-xs text-zinc-600">
          AccessScore is a heuristic, not a WCAG certification.
        </p>
      </section>
    </main>
  );
}
