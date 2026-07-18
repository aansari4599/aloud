import { NextResponse } from 'next/server';
import { AppError } from '../../../../../lib/errors';
import { rerunAudit } from '../../../../../services/patcher';

/** POST /api/audits/:id/rerun → {scoreBefore, scoreAfter, pages} (PRD §19.2). */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const result = await rerunAudit(params.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: { kind: err.kind, message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Rerun failed' } },
      { status: 500 },
    );
  }
}
