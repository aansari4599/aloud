import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { z } from 'zod';
import { db } from './db';
import { log } from './log';

// Every model call flows through here: model selection, zod validation, mandatory
// ai_cache (ARCHITECTURE §11). A cache hit makes zero API calls.

let clientInstance: OpenAI | null = null;

/** Lazy client — env may be absent at build time. Supports any OpenAI-compatible baseURL. */
function client(): OpenAI {
  clientInstance ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    ...(process.env.OPENAI_BASE_URL === undefined ? {} : { baseURL: process.env.OPENAI_BASE_URL }),
  });
  return clientInstance;
}

const MODEL_MAIN = (): string => process.env.OPENAI_MODEL_MAIN ?? 'gpt-4o';
const MODEL_MINI = (): string => process.env.OPENAI_MODEL_MINI ?? 'gpt-4o-mini';

// Generous output budget: "thinking" models spend completion tokens on reasoning first.
const MAX_OUTPUT_TOKENS = 3_000;
const CALL_TIMEOUT_MS = 45_000;
const RETRY_DELAYS_MS = [10_000, 30_000]; // free-tier rate limits are per-minute

/** Retries 429/5xx with backoff — free-tier RPM limits hit hard under parallel calls. */
async function withRetry<T>(fn: string, call: () => Promise<T>): Promise<T> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await call();
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0;
      if (status !== 429 && status < 500) throw err;
      log('ai', `${fn}-retry`, delay, { status });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return call();
}

const stmtCacheGet = db.prepare(`SELECT value_json FROM ai_cache WHERE key = ?`);
const stmtCacheSet = db.prepare(
  `INSERT OR REPLACE INTO ai_cache (key, value_json, created_at) VALUES (?, ?, ?)`,
);

/** Cache wrapper: key = sha256(fn + model + canonical-input) (PRD §19.4). Writes db, may call the API. */
async function cached<T>(
  fn: string,
  model: string,
  canonicalInput: string,
  call: () => Promise<T>,
): Promise<T> {
  const key = createHash('sha256').update(`${fn}${model}${canonicalInput}`).digest('hex');
  const hit = stmtCacheGet.get(key) as { value_json: string } | undefined;
  if (hit !== undefined) {
    log('ai', fn, 0, { cache: 'hit', model });
    return JSON.parse(hit.value_json) as T;
  }
  const started = Date.now();
  const result = await withRetry(fn, call);
  stmtCacheSet.run(key, JSON.stringify(result), new Date().toISOString());
  log('ai', fn, Date.now() - started, { cache: 'miss', model });
  return result;
}

/** Extracts a JSON object from a model reply (tolerates ```json fences). */
function parseJson(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  return JSON.parse(trimmed);
}

async function completeJson(
  model: string,
  system: string,
  user: OpenAI.Chat.ChatCompletionContentPart[],
): Promise<unknown> {
  const res = await client().chat.completions.create(
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    },
    { timeout: CALL_TIMEOUT_MS },
  );
  const content = res.choices[0]?.message.content ?? '';
  return parseJson(content);
}

const AltVerdictSchema = z.object({
  score: z.number().int().min(0).max(5),
  verdict: z.string().min(1),
  suggestedAlt: z.string(),
});

export interface AltVerdict {
  score: 0 | 1 | 2 | 3 | 4 | 5;
  verdict: string;
  suggestedAlt: string;
}

const SCORE_ALT_SYSTEM = `You are an accessibility expert judging the quality of an image's alt text.
Score 0-5: 0 = missing or meaningless (e.g. "image", "photo123"), 2 = vague or keyword-stuffed,
5 = concise and conveys the image's purpose in context.
Reply ONLY with JSON: {"score": <0-5>, "verdict": "<one short sentence>", "suggestedAlt": "<better alt text, no 'image of' prefix>"}`;

const ExplanationsSchema = z.object({
  explanations: z.array(z.string()),
});

const EXPLAIN_SYSTEM = `You are an accessibility expert writing for non-developers.
For EACH issue in the JSON array you receive, write exactly one plain-English sentence describing
what a real user misses or struggles with because of this issue — user impact, not technical detail.
Reply ONLY with JSON: {"explanations": ["<sentence for issue 1>", "<sentence for issue 2>", ...]}
in the same order as the input. Same number of sentences as input issues.`;

/**
 * One batched MINI call for up to EXPLAIN_MAX_ISSUES issues (PRD §19.4, AGENTS.md: never
 * loop single calls for batchable work). Returns sentences aligned to input order. Cached.
 */
export async function explainIssues(
  issues: { rule: string; selector: string; html: string }[],
): Promise<string[]> {
  if (issues.length === 0) return [];
  const model = MODEL_MINI();
  const compact = issues.map((i) => ({
    rule: i.rule,
    selector: i.selector.slice(0, 100),
    html: i.html.slice(0, 300),
  }));
  const canonical = JSON.stringify(compact);
  const result = await cached('explainIssues', model, canonical, async () => {
    const raw = await completeJson(model, EXPLAIN_SYSTEM, [
      { type: 'text', text: JSON.stringify(compact, null, 1) },
    ]);
    return ExplanationsSchema.parse(raw);
  });
  return result.explanations;
}

const PrBodySchema = z.object({
  markdown: z.string().min(1),
});

const PR_BODY_SYSTEM = `You write concise GitHub pull request descriptions.
You receive accessibility fixes (rule, rationale) and before/after scores.
Write friendly markdown: one-line summary, a table of fixes (Rule | What changed),
and the score improvement. No preamble outside the markdown.
Reply ONLY with JSON: {"markdown": "<the PR body>"}`;

/** PR body synthesis (PRD §19.4). MINI model, cached; deterministic fallback on failure. */
export async function writePrBody(
  fixes: { rule: string; rationale: string }[],
  scores: { before: number; after: number },
): Promise<string> {
  const model = MODEL_MINI();
  const canonical = JSON.stringify({ fixes, scores });
  const fallback = (): string =>
    [
      `## Accessibility fixes by [Aloud](https://github.com/aansari4599/aloud)`,
      '',
      `AccessScore: **${scores.before} → ${scores.after}**`,
      '',
      '| Rule | What changed |',
      '|---|---|',
      ...fixes.map((f) => `| \`${f.rule}\` | ${f.rationale.replace(/\|/g, '\\|')} |`),
    ].join('\n');
  try {
    const result = await cached('writePrBody', model, canonical, async () => {
      const raw = await completeJson(model, PR_BODY_SYSTEM, [{ type: 'text', text: canonical }]);
      return PrBodySchema.parse(raw);
    });
    return result.markdown;
  } catch {
    return fallback();
  }
}

const FixSchema = z.object({
  patchedHtml: z.string().min(1),
  rationale: z.string().min(1),
});

export interface GeneratedFix {
  patchedHtml: string;
  rationale: string;
}

const GENERATE_FIX_SYSTEM = `You are an accessibility engineer. You receive one offending HTML element,
its surrounding markup for context, and the accessibility issue found. Return the corrected element.
Rules:
- Minimal edit: change only what fixes the issue. Keep every existing attribute and class.
- Plain HTML/ARIA edits only. NEVER add, rename, or invent CSS classes or styles.
- The patchedHtml must be the corrected outerHTML of the SAME element.
- rationale: one short sentence explaining the fix.
Reply ONLY with JSON: {"patchedHtml": "<corrected element>", "rationale": "<one sentence>"}`;

/** Contextual patch for one issue (PRD §19.4). MAIN model, temperature 0.2, cached. */
export async function generateFix(
  issue: {
    rule: string;
    severity: string;
    selector: string;
    html: string;
    altVerdict?: AltVerdict;
  },
  context: string,
): Promise<GeneratedFix> {
  const model = MODEL_MAIN();
  const canonical = `${issue.rule}|${issue.html}|${context}`;
  return cached('generateFix', model, canonical, async () => {
    const suggested =
      issue.altVerdict === undefined
        ? ''
        : `\nA vision model suggests this alt text: "${issue.altVerdict.suggestedAlt}"`;
    const raw = await completeJson(model, GENERATE_FIX_SYSTEM, [
      {
        type: 'text',
        text: `Issue: ${issue.rule} (${issue.severity}) at ${issue.selector}${suggested}

Offending element:
${issue.html}

Surrounding context:
${context}`,
      },
    ]);
    return FixSchema.parse(raw);
  });
}

/** Vision judgment of alt-text quality (PRD §19.4). Calls the model (cached). */
export async function scoreAlt(imagePng: Buffer, currentAlt: string): Promise<AltVerdict> {
  const model = MODEL_MAIN();
  const imageHash = createHash('sha256').update(imagePng).digest('hex');
  return cached('scoreAlt', model, `${imageHash}|${currentAlt}`, async () => {
    const raw = await completeJson(model, SCORE_ALT_SYSTEM, [
      { type: 'text', text: `Current alt text: "${currentAlt}"` },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${imagePng.toString('base64')}` },
      },
    ]);
    const parsed = AltVerdictSchema.parse(raw);
    return { ...parsed, score: parsed.score as AltVerdict['score'] };
  });
}
