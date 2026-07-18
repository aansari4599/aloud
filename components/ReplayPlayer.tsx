'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTION_FALLBACK_WPM } from '../lib/constants';
import type { Utterance } from '../lib/types';

const RATES = [1, 1.5, 2] as const;

/**
 * Screen-reader replay: speechSynthesis playback with word-synced captions.
 * Captions are driven by fallback timers (CAPTION_FALLBACK_WPM × rate) so they work with
 * no voice engine at all; real onboundary events take over when the engine provides them.
 * Renders Utterance[] verbatim — the narrator is the only grammar source (PRD §19.1).
 */
export function ReplayPlayer({ utterances }: { utterances: Utterance[] }) {
  const [index, setIndex] = useState(0);
  const [word, setWord] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rateIdx, setRateIdx] = useState(0);

  const timers = useRef<number[]>([]);
  const boundarySeen = useRef(false);
  const advancedFor = useRef(-1);

  const rate = RATES[rateIdx];
  const current: Utterance | undefined = utterances[index];
  const words = current === undefined ? [] : current.text.split(' ');
  const issueStops = utterances.filter((u) => u.issueId !== undefined).map((u) => u.index);

  const clearTimers = useCallback((): void => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  const stopSpeech = useCallback((): void => {
    clearTimers();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [clearTimers]);

  useEffect(() => {
    if (!playing || current === undefined) return undefined;

    setWord(0);
    boundarySeen.current = false;
    const text = current.text;
    const wordList = text.split(' ');
    const wordMs = 60_000 / (CAPTION_FALLBACK_WPM * rate);

    const advance = (): void => {
      if (advancedFor.current === index) return;
      advancedFor.current = index;
      if (index + 1 < utterances.length) {
        setIndex(index + 1);
      } else {
        setPlaying(false);
        setIndex(0);
        setWord(0);
      }
    };

    for (let i = 0; i < wordList.length; i += 1) {
      timers.current.push(
        window.setTimeout(() => {
          if (!boundarySeen.current) setWord(i);
        }, i * wordMs),
      );
    }
    timers.current.push(
      window.setTimeout(
        () => {
          if (!boundarySeen.current) advance();
        },
        wordList.length * wordMs + 200,
      ),
    );

    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.onboundary = (e) => {
        boundarySeen.current = true;
        setWord(Math.max(0, text.slice(0, e.charIndex).split(' ').length - 1));
      };
      u.onend = () => advance();
      window.speechSynthesis.speak(u);
    }

    return () => stopSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, rateIdx]);

  // The #1 replay bug: speech must die with the component (AGENTS.md React rules).
  useEffect(() => () => stopSpeech(), [stopSpeech]);

  const jump = (direction: 1 | -1): void => {
    const stops = direction === 1 ? issueStops : [...issueStops].reverse();
    const target = stops.find((i) => (direction === 1 ? i > index : i < index));
    if (target !== undefined) {
      advancedFor.current = -1;
      setIndex(target);
      setWord(0);
    }
  };

  const togglePlay = (): void => {
    if (playing) {
      stopSpeech();
      setPlaying(false);
    } else {
      advancedFor.current = -1;
      setPlaying(true);
    }
  };

  if (utterances.length === 0) {
    return <p className="text-sm text-zinc-500">No narration available for this page.</p>;
  }

  return (
    <div className="w-full rounded-2xl border border-surface-line bg-surface-raised p-6">
      {/* caption area — karaoke style */}
      <div className="flex min-h-36 flex-col justify-center gap-2 text-center" aria-live="off">
        <p className="truncate text-sm text-zinc-600">
          {index > 0 ? utterances[index - 1].text : ' '}
        </p>
        <p data-testid="caption" className="text-2xl font-semibold leading-snug text-zinc-100">
          {words.map((w, i) => (
            <span
              key={`${index}-${i}`}
              data-word={i}
              className={
                i === word && playing
                  ? 'rounded bg-accent px-1 text-zinc-950'
                  : i <= word && playing
                    ? 'text-zinc-100'
                    : 'text-zinc-400'
              }
            >
              {w}{' '}
            </span>
          ))}
        </p>
        <p className="truncate text-sm text-zinc-600">
          {index + 1 < utterances.length ? utterances[index + 1].text : ' '}
        </p>
      </div>

      {current?.issueId !== undefined && (
        <p className="mt-2 text-center text-xs font-semibold uppercase tracking-widest text-accent">
          ⚑ this is an accessibility issue
        </p>
      )}

      {/* transport controls */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => jump(-1)}
          aria-label="Previous issue"
          className="rounded-full border border-surface-line px-4 py-2 text-lg text-zinc-300 hover:border-accent/60"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play"
          className="h-14 w-14 rounded-full bg-accent text-2xl text-zinc-950 hover:bg-amber-300"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          onClick={() => jump(1)}
          aria-label="Next issue"
          data-testid="next-issue"
          className="rounded-full border border-surface-line px-4 py-2 text-lg text-zinc-300 hover:border-accent/60"
        >
          ⏭
        </button>
        <button
          type="button"
          onClick={() => setRateIdx((rateIdx + 1) % RATES.length)}
          aria-label={`Playback speed ${rate}x`}
          data-testid="rate"
          className="rounded-full border border-surface-line px-3 py-2 font-mono text-sm text-zinc-300 hover:border-accent/60"
        >
          {rate}×
        </button>
      </div>

      <p className="mt-4 text-center font-mono text-xs text-zinc-600">
        <span data-testid="position">{index + 1}</span> / {utterances.length} · {issueStops.length}{' '}
        issues in narration
      </p>
    </div>
  );
}
