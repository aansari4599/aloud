import { NextResponse } from 'next/server';
import { getAuditJob, getPages } from '../../../../lib/db';
import type { AuditJob, PageResult } from '../../../../lib/types';

/** GET /api/audits/:id → {job, pages?} — pages ship once, on done (PRD §19.2). Reads db. */
export function GET(_req: Request, { params }: { params: { id: string } }): NextResponse {
  const job = getAuditJob(params.id);
  if (!job) {
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Audit not found' } },
      { status: 404 },
    );
  }
  const payload: { job: AuditJob; pages?: PageResult[] } = { job };
  if (job.status === 'done') {
    payload.pages = getPages(job.id);
  }
  return NextResponse.json(payload);
}
