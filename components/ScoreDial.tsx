'use client';

import { useEffect, useRef, useState } from 'react';
import { GRADE_BANDS } from '../lib/constants';

const gradeFor = (score: number): string => GRADE_BANDS.find((b) => score >= b.min)?.grade ?? 'F';

const colorFor = (score: number): string => {
  if (score >= 90) return '#34d399'; // emerald-400
  if (score >= 65) return '#fbbf24'; // amber-400
  if (score >= 50) return '#fb923c'; // orange-400
  return '#f87171'; // red-400
};

const ANIMATION_MS = 1400;

/**
 * Animated 0–100 AccessScore dial. Counts up to `before` on mount; when `after`
 * arrives it transitions before → after (the 42 → 91 moment, PRD §F6).
 */
export function ScoreDial({ before, after }: { before: number; after?: number }) {
  const target = after ?? before;
  const [value, setValue] = useState(0);
  const animatedFrom = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setValue(target);
      return undefined;
    }
    const from = animatedFrom.current ?? 0;
    animatedFrom.current = target;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const color = colorFor(value);

  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg
          width="220"
          height="220"
          viewBox="0 0 220 220"
          role="img"
          aria-label={`AccessScore ${target} out of 100, grade ${gradeFor(target)}`}
        >
          <circle cx="110" cy="110" r={radius} fill="none" stroke="#27272a" strokeWidth="14" />
          <circle
            cx="110"
            cy="110"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - value / 100)}
            transform="rotate(-90 110 110)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            data-testid="score-value"
            className="text-6xl font-extrabold tracking-tightest"
            style={{ color }}
          >
            {value}
          </span>
          <span className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            grade {gradeFor(value)}
          </span>
        </div>
      </div>
      {after !== undefined && (
        <p className="font-mono text-sm text-zinc-400">
          {before} →{' '}
          <span className="font-bold" style={{ color: colorFor(after) }}>
            {after}
          </span>{' '}
          after fixes
        </p>
      )}
      <figcaption className="text-xs text-zinc-600">
        AccessScore — heuristic score, not a WCAG certification
      </figcaption>
    </figure>
  );
}
