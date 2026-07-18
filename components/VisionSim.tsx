'use client';

import { useState } from 'react';

// Color-vision-deficiency simulation matrices (feColorMatrix, RGBA rows).
const COLOR_MATRICES: Record<string, string> = {
  protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
  deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
  tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
};

interface Condition {
  key: string;
  label: string;
  description: string;
  filter: string; // CSS filter value
}

const CONDITIONS: Condition[] = [
  { key: 'original', label: 'Original', description: 'Typical vision', filter: 'none' },
  {
    key: 'blur',
    label: 'Low acuity',
    description: 'Uncorrected vision, cataracts',
    filter: 'blur(3px)',
  },
  {
    key: 'contrast',
    label: 'Low contrast',
    description: 'Contrast sensitivity loss, glare',
    filter: 'contrast(40%) brightness(115%)',
  },
  {
    key: 'protanopia',
    label: 'Protanopia',
    description: 'No red receptors (~1% of men)',
    filter: 'url(#cvd-protanopia)',
  },
  {
    key: 'deuteranopia',
    label: 'Deuteranopia',
    description: 'No green receptors (~1% of men)',
    filter: 'url(#cvd-deuteranopia)',
  },
  {
    key: 'tritanopia',
    label: 'Tritanopia',
    description: 'No blue receptors (rare)',
    filter: 'url(#cvd-tritanopia)',
  },
];

/** Vision simulators over the page screenshot (screenshot, not iframe — ADR-5). */
export function VisionSim({ src, siteUrl }: { src: string; siteUrl: string }) {
  const [active, setActive] = useState('original');
  const condition = CONDITIONS.find((c) => c.key === active) ?? CONDITIONS[0];

  return (
    <div className="w-full rounded-2xl border border-surface-line bg-surface-raised p-6">
      {/* SVG filter definitions for CVD simulation */}
      <svg aria-hidden className="absolute h-0 w-0">
        <defs>
          {Object.entries(COLOR_MATRICES).map(([key, values]) => (
            <filter id={`cvd-${key}`} key={key}>
              <feColorMatrix type="matrix" values={values} />
            </filter>
          ))}
        </defs>
      </svg>

      <div role="radiogroup" aria-label="Vision condition" className="mb-4 flex flex-wrap gap-2">
        {CONDITIONS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={active === c.key}
            data-testid={`sim-${c.key}`}
            onClick={() => setActive(c.key)}
            title={c.description}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              active === c.key
                ? 'border-accent bg-accent text-zinc-950'
                : 'border-surface-line text-zinc-300 hover:border-accent/60'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p className="mb-3 text-sm text-zinc-500">{condition.description}</p>

      <div className="max-h-[480px] overflow-auto rounded-lg border border-surface-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- dynamic runtime screenshot, next/image adds nothing */}
        <img
          src={src}
          alt={`Screenshot of ${siteUrl} as seen with ${condition.label.toLowerCase()}`}
          data-testid="sim-image"
          style={{ filter: condition.filter }}
          className="w-full"
        />
      </div>
    </div>
  );
}
