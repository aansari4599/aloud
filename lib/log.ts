/**
 * Single-line JSON logger (ARCHITECTURE §13). Writes to stdout.
 * Failures pass `{ ok: false, kind }` in `extra`.
 */
export function log(
  jobId: string,
  step: string,
  ms: number,
  extra?: Record<string, unknown>,
): void {
  process.stdout.write(`${JSON.stringify({ jobId, step, ms, ...extra })}\n`);
}
