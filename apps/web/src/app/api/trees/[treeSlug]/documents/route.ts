import { NextResponse } from 'next/server';
import { buildObjectKey, checksum as computeChecksum, validateUpload } from '@chronolignee/storage';
import { findDocumentByChecksum, registerDocument, type DocumentKind } from '@chronolignee/db';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { objectStore } from '@/lib/storage';
import { resolveTreeAccess } from '@/server/access';

/**
 * Uploading a document.
 *
 * The bytes go to object storage under a key this server generates; the
 * filename the browser sent is kept only as a label. A user-supplied filename
 * in a storage key is a path-traversal primitive and an enumeration oracle at
 * the same time, and neither is worth the convenience of a tidy bucket.
 *
 * What the file claims to be is not consulted. The extension and the declared
 * MIME type both come from whoever is uploading; the first bytes come from
 * the file, and those are what decide whether this is a JPEG.
 */

export const runtime = 'nodejs';

/**
 * Twenty-five megabytes.
 *
 * A scan of a parish register page at a readable resolution is a few
 * megabytes; a phone photograph of a headstone is under ten. This leaves
 * headroom for a multi-page PDF without inviting someone to park a video here.
 */
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ treeSlug: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { treeSlug } = await params;
  const access = await resolveTreeAccess(treeSlug);
  // A tree the viewer cannot write to and a tree that does not exist answer
  // identically: the existence of a family's archive is not something an
  // upload endpoint should confirm.
  if (!access || !access.canEdit) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'NO_FILE' }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: 'EMPTY' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'TOO_LARGE', maxBytes: MAX_BYTES }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = await validateUpload(bytes, {
    maxBytes: MAX_BYTES,
    // Passed to be compared against the magic bytes, never to be believed.
    declaredMime: file.type,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 415 });
  }

  // Deduplicated by content, not by name. The same act downloaded twice from
  // an archive portal is one document; storing it twice would split the
  // citations that point at it across two rows.
  const digest = computeChecksum(bytes);
  const existing = await findDocumentByChecksum(db, access.treeId, digest);
  if (existing) {
    return NextResponse.json({ documentId: existing.id, duplicate: true, title: existing.title });
  }

  const storageKey = buildObjectKey(access.treeId, 'document', validation.extension);
  await objectStore.put(storageKey, bytes, {
    contentType: validation.mime,
    // The bucket is private and stays private. Documents are reached through
    // a short-lived presigned URL, never by a guessable address.
    checksum: digest,
  });

  const title = typeof form.get('title') === 'string' ? String(form.get('title')).trim() : '';
  const kind = typeof form.get('kind') === 'string' ? String(form.get('kind')) : 'OTHER';
  const sourceId = typeof form.get('sourceId') === 'string' ? String(form.get('sourceId')) : '';

  try {
    const document = await registerDocument(
      db,
      {
        title: title || file.name,
        kind: kind as DocumentKind,
        originalFilename: file.name,
        mimeType: validation.mime,
        byteSize: bytes.byteLength,
        checksum: digest,
        storageKey,
        ...(sourceId ? { sourceId } : {}),
      },
      { treeId: access.treeId, actorId: session.user.id },
    );

    return NextResponse.json({ documentId: document.documentId, duplicate: false });
  } catch (error) {
    // The row failed, so the object is orphaned. Removing it here keeps the
    // bucket from filling with bytes nothing references — the one cleanup
    // that cannot be done later, because nothing will remember the key.
    await objectStore.delete(storageKey).catch(() => undefined);
    if (error instanceof Error && error.message.includes('No Source found')) {
      return NextResponse.json({ error: 'SOURCE_NOT_FOUND' }, { status: 400 });
    }
    return NextResponse.json({ error: 'WRITE_FAILED' }, { status: 500 });
  }
}
