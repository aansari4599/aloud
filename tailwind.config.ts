import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#fbbf24', // amber-400 — warm, audio-meter warmth on dark
          dim: '#b45309',
        },
        surface: {
          DEFAULT: '#09090b', // zinc-950
          raised: '#18181b', // zinc-900
          line: '#27272a', // zinc-800
        },
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
    },
  },
  plugins: [],
};

export default config;
