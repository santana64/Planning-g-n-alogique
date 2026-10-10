import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { objectStore } from '@/lib/storage';
import { isUuid } from '@/lib/ids';
import { resolveTreeAccess } from '@/server/access';

/**
 * Fetching a document.
 *
 * Authorisation happens here, then a short-lived presigned URL is handed back.
 * The bucket is private: there is no address anyone can guess, and no URL that
 * keeps working after the person who obtained it loses access to the tree.
 *
 * A redirect rather than proxying the bytes, so a fifteen-megabyte scan does
 * not travel through the application server twice.
 */

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ treeSlug: string; documentId: string }> },
): Promise<NextResponse> {
  const { treeSlug, documentId } = await params;
  if (!isUuid(documentId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const access = await resolveTreeAccess(treeSlug);
  if (!access) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const document = await db.document.findFirst({
    where: { id: documentId, treeId: access.treeId, deletedAt: null },
    select: { storageKey: true, privacy: true },
  });
  if (!document) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // The same ladder the listing uses, re-checked here because a document id
  // is a URL and a listing is only a convenience. REDACTED is withheld from
  // anyone outside the tree; RESTRICTED is for its administrators.
  const isAdmin = access.role === 'OWNER' || access.role === 'ADMIN';
  const withheld =
    (document.privacy === 'RESTRICTED' && !isAdmin) ||
    (document.privacy === 'REDACTED' && access.role === null);
  if (withheld) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // A store on disk signs nothing: the bytes come from the content route,
  // which repeats every check above.
  const url =
    (await objectStore.presignDownload(document.storageKey)) ??
    new URL(`/api/trees/${treeSlug}/documents/${documentId}/content`, request.url).toString();

  return NextResponse.redirect(url, {
    // Never cached by a proxy: the URL expires, and a cached redirect would
    // hand a stale signature to the next reader.
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
