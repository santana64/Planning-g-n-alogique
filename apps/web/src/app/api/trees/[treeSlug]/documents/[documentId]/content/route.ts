import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/ids';
import { sendPrivateObject } from '@/lib/private-file';
import { loadDocumentView } from '@/server/documents';

/**
 * A document's bytes, for the viewer.
 *
 * The download link still redirects to a presigned URL (the parent route);
 * this one serves the same file from the application's origin, because the
 * viewer draws it — pages of a PDF on a canvas, an image under its zoom —
 * and a page can only do that with bytes its own policy lets it fetch.
 */

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ treeSlug: string; documentId: string }> },
): Promise<NextResponse> {
  const { treeSlug, documentId } = await params;
  if (!isUuid(documentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const view = await loadDocumentView(treeSlug, documentId);
  if (!view) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return sendPrivateObject(view.storageKey, view.document.mimeType);
}
