import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getScreenshotPath } from '../../../../lib/db';

/** GET /api/screenshots/:pageId → the page's JPEG screenshot. Reads db + disk. */
export async function GET(
  _req: Request,
  { params }: { params: { pageId: string } },
): Promise<NextResponse> {
  const path = getScreenshotPath(params.pageId);
  if (path === undefined) {
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Screenshot not found' } },
      { status: 404 },
    );
  }
  try {
    const buffer = await readFile(path);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json(
      { error: { kind: 'INTERNAL', message: 'Screenshot unavailable' } },
      { status: 404 },
    );
  }
}
