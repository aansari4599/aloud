import { NextResponse } from 'next/server';
import { AppError } from '../../../../../lib/errors';
import { openFixPr } from '../../../../../services/github';

/** POST /api/audits/:id/pr → {prUrl} (PRD §19.2). Demo repo only (ADR-8). */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const prUrl = await openFixPr(params.id);
    return NextResponse.json({ prUrl });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: { kind: err.kind, message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'PR creation failed' } },
      { status: 500 },
    );
  }
}
