import { NextResponse } from 'next/server';
import { analyseUpload } from '@/server/gedcom-import';
import { getSession } from '@/lib/session';
import { env } from '@/lib/env';

/**
 * Analyse an uploaded GEDCOM file. Writes nothing to the tree.
 *
 * A route handler rather than a Server Action because this receives a file:
 * multipart bodies and upload progress are what route handlers are for, and
 * the Server Action body limit is not the right lever for a 40 MB export.
 */
export const runtime = 'nodejs';

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  TOO_LARGE: 413,
  NOT_GEDCOM: 415,
  EMPTY: 400,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ treeSlug: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { treeSlug } = await params;

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > env.MAX_UPLOAD_BYTES) {
    // Refused from the header before the body is read, so an oversized upload
    // costs neither bandwidth nor memory.
    return NextResponse.json({ error: 'TOO_LARGE' }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'NO_FILE' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await analyseUpload(treeSlug, { name: file.name, bytes }, session.user.id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: ERROR_STATUS[result.error] ?? 400 },
    );
  }
  return NextResponse.json(result.analysis);
}
