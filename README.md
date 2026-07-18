# Aloud 🔊

**Hear your website the way 1 in 6 users experience it. Then let the agent fix it.**

Paste any URL. Aloud audits it, plays the page back as a blind user hears it — synthesized
screen-reader narration with synced captions — shows it as low-vision and color-blind users see
it, then **writes the code fixes, opens a real GitHub pull request, re-audits the patched
version, and shows the AccessScore jump**.

Report → felt experience → shipped fix. One loop, one product.

## Try it in 60 seconds

> **Live URL:** _deploy pending — run locally below_
> **Demo PR opened by Aloud:** https://github.com/aansari4599/aloud-demo-site/pull/1
> **Backup video:** _slot — recorded on demo day_

1. Paste a URL (or click a pre-audited gallery site).
2. Watch the live audit stream: *"Found 14 images… walking the keyboard…"*
3. **AccessScore dial** animates — heuristic 0–100, honestly labeled.
4. **Hear it** — press play. `image, I M G underscore four seven two three` is what a screen
   reader actually says for an unlabeled photo. The clickable `<div>` styled as a button?
   Silence — it doesn't exist to the reader.
5. **See it** — blur, low-contrast, protanopia/deuteranopia/tritanopia over the real screenshot.
6. **Fix it** — ✨ Fix with AI → unified diffs → Apply & re-audit → **50 → 92** → Open PR
   (live, on the demo repo).

Hostile input welcome: login walls, bot-blocked sites, PDFs, private IPs — every failure has a
designed card, never a stack trace.

## How the models are used

All calls flow through `lib/ai.ts`: zod-validated outputs, sha256-keyed SQLite cache
(**a cache hit makes zero API calls** — repeat audits are near-free), 429 backoff. The client is
OpenAI-compatible: point `OPENAI_BASE_URL` at OpenAI, Gemini, or any compatible endpoint.

| Call site | Model role | Why a model at all |
|---|---|---|
| Alt-text quality (image crop + alt → verdict + suggested alt) | MAIN, vision | Semantic judgment axe can't make — catches `alt="image"`, mismatched alts |
| Issue → plain-English user impact | MINI, **one batched call** for top 30 | Cards a non-dev understands |
| Fix generation (element + ±20 lines context → patch + rationale) | MAIN, temp 0.2 | Contextual, minimal HTML/ARIA edits; post-checked to never invent CSS classes |
| PR title + body synthesis | MINI (deterministic fallback) | Formatting task |

Everything else is deterministic engineering: axe-core, a real keyboard walk (Tab ×50 with trap
detection), heading checks, NVDA-style narration grammar, jsdom patching, `file://` re-audit.

## Architecture

```
                        ┌─────────────────────────────────────────────┐
  Judge / User          │  Railway container (single service)          │
 ───────────────┐       │  ┌───────────────────────────────────────┐  │
  paste URL,    ├──────▶│  │ Next.js 14 (UI + API, Node runtime)   │  │
  poll results, │ HTTPS │  │  ├── p-queue job runner (cc = 2)      │──┼──▶ Target websites
  play replay   │◀──────│  │  ├── Playwright (1 × Chromium)        │  │    (Playwright fetch)
 ───────────────┘       │  │  ├── narrator / scorer / fixer        │──┼──▶ OpenAI-compatible API
                        │  │  └── octokit PR service               │──┼──▶ GitHub API
                        │  └───────────────────────────────────────┘  │    (demo repo only)
                        │  /data volume: SQLite · screenshots · patched│
                        └─────────────────────────────────────────────┘
```

One process, one SQLite file, no workers, no Redis. Pipeline per audit:
capture (screenshot + a11y tree + HTML) → crawl (BFS, ≤8 same-origin pages) → axe + keyboard
walk + heading checks + vision alt-scoring → narration → AccessScore → *user clicks fix* →
patches → jsdom apply → `file://` re-audit → after-score → PR.

Security: SSRF guard (DNS-resolved private-IP blocking, redirect re-checks) on every
user-supplied URL; patched copies are never re-served publicly; the GitHub token only ever
touches the demo repo.

## Run locally

```bash
npm install
npx playwright install chromium
cp .env.example .env   # add your OPENAI_API_KEY (any OpenAI-compatible endpoint works)
npm run dev            # http://localhost:3000
```

Works without a key too — vision scoring, explanations, and fixes degrade gracefully;
audit + narration + simulators are fully deterministic.

Offline test bed (no network, no key needed for most):

```bash
npx tsx scripts/verify.ts run file://$PWD/fixtures/broken/index.html   # audit → score 50
npx tsx scripts/verify.ts fix     # AI diffs for the seeded issues
npx tsx scripts/verify.ts rerun   # apply → re-audit → 50 → 92
npx tsx scripts/prebake.ts        # bake the wifi-proof gallery
```

## Honesty notes

- AccessScore is a **heuristic, not a WCAG certification** — the UI says so on every dial.
- Automated checks catch a fraction of real accessibility barriers; the replay exists precisely
  because numbers don't convey what a broken page *feels* like.
- Not auto-fixed (by design, v1): color contrast, keyboard traps, layout issues — flagged and
  explained instead.
- Iframes and shadow DOM are skipped in v1. Strict-CSP sites degrade to a partial audit.

## License

Apache-2.0
