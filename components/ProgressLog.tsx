import type { ProgressEvent } from '../lib/types';

/** Live step log while an audit runs. Pure render — polling lives in the page. */
export function ProgressLog({ events, running }: { events: ProgressEvent[]; running: boolean }) {
  return (
    <div className="w-full max-w-xl rounded-xl border border-surface-line bg-surface-raised p-6">
      <ol aria-live="polite" className="space-y-2">
        {events.map((e, i) => {
          const latest = i === events.length - 1;
          return (
            <li
              key={`${e.at}-${i}`}
              className={`flex items-baseline gap-3 text-sm ${latest && running ? 'text-zinc-100' : 'text-zinc-500'}`}
            >
              <span
                aria-hidden
                className={latest && running ? 'animate-pulse text-accent' : 'text-zinc-600'}
              >
                {latest && running ? '●' : '✓'}
              </span>
              <span>
                {e.step}
                {e.detail !== undefined && (
                  <span className="ml-2 break-all text-zinc-600">{e.detail}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
