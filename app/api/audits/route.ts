import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '../../../lib/errors';
import { ssrfGuard } from '../../../lib/ssrf';
import { enqueueAudit } from '../../../services/queue';

const BodySchema = z.object({
  url: z.string().min(1).max(2000),
  crawl: z.boolean().optional().default(true),
});

/** POST /api/audits {url, crawl} → 202 {id} (PRD §19.2). Enqueues the job. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Body must be {url: string, crawl?: boolean}' } },
      { status: 400 },
    );
  }

  try {
    const safeUrl = await ssrfGuard(parsed.url); // early feedback; guarded again at navigation
    const id = enqueueAudit(safeUrl.href, parsed.crawl);
    return NextResponse.json({ id }, { status: 202 });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: { kind: err.kind, message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Unexpected error' } },
      { status: 500 },
    );
  }
}
