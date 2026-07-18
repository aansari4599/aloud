import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAuditJob } from '../../../../../lib/db';
import { generateFixes } from '../../../../../services/fixer';

const BodySchema = z.object({
  issueIds: z.array(z.string()).optional(),
});

/** POST /api/audits/:id/fixes {issueIds?} → {fixes} (PRD §19.2). Calls the model (cached). */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const job = getAuditJob(params.id);
  if (!job || job.status !== 'done') {
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Audit not found or not finished' } },
      { status: 404 },
    );
  }
  let body: z.infer<typeof BodySchema> = {};
  try {
    const text = await req.text();
    body = text === '' ? {} : BodySchema.parse(JSON.parse(text));
  } catch {
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Body must be {issueIds?: string[]}' } },
      { status: 400 },
    );
  }
  const fixes = await generateFixes(params.id, body.issueIds);
  return NextResponse.json({ fixes });
}
