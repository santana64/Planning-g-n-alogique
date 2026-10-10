import { NextResponse } from 'next/server';
import { buildObjectKey, checksum as computeChecksum, validateUpload } from '@chronolignee/storage';
import { findMediaByChecksum, registerMedia } from '@chronolignee/db';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueueMediaDerivatives } from '@/lib/queue';
import { getSession } from '@/lib/session';
import { objectStore } from '@/lib/storage';
import { resolveTreeAccess } from '@/server/access';

/**
 * Uploading a photograph.
 *
 * The same discipline as documents — the bytes decide what the file is, the
 * key is random, the filename is a label — and images only: a photograph
 * here is something people will be recognised in, and audio or video would
 * need a viewer and a privacy review of their own.
 *
 * The thumbnail and preview are queued for the worker, never made here: a
 * 40-megapixel TIFF takes seconds to decode, which is no time to hold a
 * request open.
 */

export const runtime = 'nodejs';

/** Forty megabytes: a high-resolution scan of a glass plate, not a video. */
const MAX_BYTES = 40 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ treeSlug: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { treeSlug } = await params;
  const access = await resolveTreeAccess(treeSlug);
  if (!access || !access.canEdit) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'NO_FILE' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'EMPTY' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'TOO_LARGE', maxBytes: MAX_BYTES }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = await validateUpload(bytes, { maxBytes: MAX_BYTES, declaredMime: file.type });
  if (!validation.ok) return NextResponse.json({ error: validation.reason }, { status: 415 });
  if (validation.category !== 'image') {
    return NextResponse.json({ error: 'NOT_AN_IMAGE' }, { status: 415 });
  }

  const digest = computeChecksum(bytes);
  const existing = await findMediaByChecksum(db, access.treeId, digest);
  if (existing) return NextResponse.json({ mediaId: existing.id, duplicate: true });

  const storageKey = buildObjectKey(access.treeId, 'media', validation.extension);
  await objectStore.put(storageKey, bytes, { contentType: validation.mime, checksum: digest });

  const title = typeof form.get('title') === 'string' ? String(form.get('title')).trim() : '';
  let mediaId: string;
  try {
    ({ mediaId } = await registerMedia(
      db,
      {
        originalFilename: file.name,
        mimeType: validation.mime,
        byteSize: bytes.byteLength,
        checksum: digest,
        storageKey,
        title: title || null,
      },
      { treeId: access.treeId, actorId: session.user.id },
    ));
  } catch {
    // The row failed, so the object is orphaned; nothing else will remember it.
    await objectStore.delete(storageKey).catch(() => undefined);
    return NextResponse.json({ error: 'WRITE_FAILED' }, { status: 500 });
  }

  try {
    await enqueueMediaDerivatives({ treeId: access.treeId, mediaId, storageKey });
  } catch (error) {
    // The photograph is saved and shown from its original; only the light
    // versions wait. Logged, not failed.
    logger.error(
      {
        event: 'media.derivatives.not_queued',
        treeId: access.treeId,
        mediaId,
        error: error instanceof Error ? error.name : typeof error,
      },
      'media derivatives not queued',
    );
  }

  return NextResponse.json({ mediaId, duplicate: false });
}
