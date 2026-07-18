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
  const result = await call();
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
