import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/ids';
import { sendPrivateObject } from '@/lib/private-file';
import { resolveMediaObject, type MediaVariant } from '@/server/media';

/**
 * One photograph, at the size asked for.
 *
 * Every check runs again on every request — the tree, the photograph's
 * privacy, and whether anyone recognised in it is hidden from this reader —
 * because an image URL is copied, bookmarked and pasted far from the page
 * that showed it.
 */

export const runtime = 'nodejs';

const VARIANTS: readonly MediaVariant[] = ['thumbnail', 'preview', 'original'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ treeSlug: string; mediaId: string }> },
): Promise<NextResponse> {
  const { treeSlug, mediaId } = await params;
  if (!isUuid(mediaId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const requested = new URL(request.url).searchParams.get('variant') ?? 'preview';
  const variant = (VARIANTS as readonly string[]).includes(requested)
    ? (requested as MediaVariant)
    : 'preview';

  const object = await resolveMediaObject(treeSlug, mediaId, variant);
  if (!object) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return sendPrivateObject(object.key, object.contentType, {
    maxAgeSeconds: variant === 'original' ? 60 : 600,
  });
}
