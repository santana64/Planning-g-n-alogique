import 'server-only';
import { cache } from 'react';
import { dateToJdn, jdnToGregorian } from '@chronolignee/domain';
import { db } from '@/lib/db';
import { hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';
import { treeGraph } from './graph-cache';

/**
 * Photographs, for one reader.
 *
 * The rule a photograph adds to the rest of the privacy model: a face is
 * personal data. A photograph in which someone this reader may not see has
 * been recognised is withheld from that reader entirely — not blurred, not
 * shown without the name. A cropped-out tag would still publish the face, and
 * "a protected person is in this picture" next to an empty rectangle says
 * who it is to anyone who knows the family.
 *
 * On top of that, the same ladder as documents: REDACTED is for members,
 * RESTRICTED for the tree's administrators.
 */

export type MediaVariant = 'thumbnail' | 'preview' | 'original';

export interface PhotoTag {
  readonly personId: string;
  readonly name: string;
  readonly region: { x: number; y: number; width: number; height: number } | null;
  readonly note: string | null;
}

export interface PhotoCard {
  readonly mediaId: string;
  readonly title: string;
  readonly captured: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly tagged: readonly string[];
  readonly processed: boolean;
}

export interface PhotoDetail extends PhotoCard {
  readonly description: string | null;
  readonly copyright: string | null;
  readonly capturedOriginalText: string | null;
  readonly originalFilename: string;
  readonly tags: readonly PhotoTag[];
}

function privacyAllows(access: TreeAccess, privacy: string): boolean {
  const isAdmin = access.role === 'OWNER' || access.role === 'ADMIN';
  if (privacy === 'RESTRICTED') return isAdmin;
  if (privacy === 'REDACTED') return access.role !== null;
  return true;
}

const capturedLabel = (earliest: number | null, latest: number | null, text: string | null) => {
  if (text) return text;
  if (earliest === null) return null;
  const from = jdnToGregorian(earliest).year;
  const to = latest === null ? from : jdnToGregorian(latest).year;
  return from === to ? String(from) : `${from} – ${to}`;
};

async function visibilityFor(access: TreeAccess) {
  const graph = await treeGraph(access.treeId, dateToJdn(new Date()));
  const hidden = hiddenInGraph(graph, access);
  return {
    visible: (personId: string) => graph.people.has(personId) && !hidden(personId),
    nameOf: (personId: string) => graph.people.get(personId)?.displayName ?? '',
    people: [...graph.people.values()]
      .filter((person) => !hidden(person.id))
      .map((person) => ({ id: person.id, name: person.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  };
}

const MEDIA_SELECT = {
  id: true,
  title: true,
  originalFilename: true,
  privacy: true,
  width: true,
  height: true,
  thumbnailStorageKey: true,
  capturedEarliestJdn: true,
  capturedLatestJdn: true,
  capturedOriginalText: true,
  description: true,
  copyright: true,
  personTags: {
    select: { personId: true, x: true, y: true, width: true, height: true, note: true },
  },
} as const;

type MediaRow = {
  id: string;
  title: string | null;
  originalFilename: string;
  privacy: string;
  width: number | null;
  height: number | null;
  thumbnailStorageKey: string | null;
  capturedEarliestJdn: number | null;
  capturedLatestJdn: number | null;
  capturedOriginalText: string | null;
  description: string | null;
  copyright: string | null;
  personTags: Array<{
    personId: string;
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
    note: string | null;
  }>;
};

function card(row: MediaRow, nameOf: (id: string) => string): PhotoCard {
  return {
    mediaId: row.id,
    title: row.title ?? row.originalFilename,
    captured: capturedLabel(
      row.capturedEarliestJdn,
      row.capturedLatestJdn,
      row.capturedOriginalText,
    ),
    width: row.width,
    height: row.height,
    tagged: row.personTags.map((tag) => nameOf(tag.personId)),
    processed: row.thumbnailStorageKey !== null,
  };
}

/** Every photograph this reader may see, newest first. */
export const loadGallery = cache(async (treeSlug: string) => {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;
  const { visible, nameOf, people } = await visibilityFor(access);
  const rows = (await db.media.findMany({
    where: { treeId: access.treeId, deletedAt: null, kind: 'IMAGE' },
    select: MEDIA_SELECT,
    orderBy: { createdAt: 'desc' },
  })) as MediaRow[];
  const photos = rows
    .filter((row) => privacyAllows(access, row.privacy))
    .filter((row) => row.personTags.every((tag) => visible(tag.personId)))
    .map((row) => card(row, nameOf));
  return { access, photos, people };
});

/** One photograph with its tags, or null when this reader may not see it. */
export const loadPhoto = cache(async (treeSlug: string, mediaId: string) => {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;
  const row = (await db.media.findFirst({
    where: { id: mediaId, treeId: access.treeId, deletedAt: null, kind: 'IMAGE' },
    select: MEDIA_SELECT,
  })) as MediaRow | null;
  if (!row || !privacyAllows(access, row.privacy)) return null;
  const { visible, nameOf, people } = await visibilityFor(access);
  if (!row.personTags.every((tag) => visible(tag.personId))) return null;

  const photo: PhotoDetail = {
    ...card(row, nameOf),
    description: row.description,
    copyright: row.copyright,
    capturedOriginalText: row.capturedOriginalText,
    originalFilename: row.originalFilename,
    tags: row.personTags.map((tag) => ({
      personId: tag.personId,
      name: nameOf(tag.personId),
      note: tag.note,
      region:
        tag.x !== null && tag.y !== null && tag.width !== null && tag.height !== null
          ? { x: tag.x, y: tag.y, width: tag.width, height: tag.height }
          : null,
    })),
  };
  return { access, photo, people };
});

/** The photographs one person has been recognised in, for their record. */
export async function loadPersonPhotos(
  access: TreeAccess,
  personId: string,
): Promise<readonly PhotoCard[]> {
  const { visible, nameOf } = await visibilityFor(access);
  if (!visible(personId)) return [];
  const rows = (await db.media.findMany({
    where: {
      treeId: access.treeId,
      deletedAt: null,
      kind: 'IMAGE',
      personTags: { some: { personId } },
    },
    select: MEDIA_SELECT,
    orderBy: [{ capturedEarliestJdn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  })) as MediaRow[];
  return rows
    .filter((row) => privacyAllows(access, row.privacy))
    .filter((row) => row.personTags.every((tag) => visible(tag.personId)))
    .map((row) => card(row, nameOf));
}

/**
 * The storage key behind one variant, after every check above.
 *
 * A variant not made yet falls back to the original — the worker may not
 * have reached it — and the original itself is for members: it is the file
 * as uploaded, metadata and all.
 */
export async function resolveMediaObject(
  treeSlug: string,
  mediaId: string,
  variant: MediaVariant,
): Promise<{ key: string; contentType: string; filename: string } | null> {
  const loaded = await loadPhoto(treeSlug, mediaId);
  if (!loaded) return null;
  const row = await db.media.findUnique({
    where: { id: mediaId },
    select: {
      storageKey: true,
      thumbnailStorageKey: true,
      previewStorageKey: true,
      mimeType: true,
      originalFilename: true,
    },
  });
  if (!row) return null;

  const derived =
    variant === 'thumbnail'
      ? row.thumbnailStorageKey
      : variant === 'preview'
        ? row.previewStorageKey
        : null;
  if (derived) return { key: derived, contentType: 'image/webp', filename: row.originalFilename };
  // The original, only to members: a stranger gets the stripped derivative or
  // nothing, never the EXIF that may hold where the photograph was taken.
  if (loaded.access.role === null) return null;
  return { key: row.storageKey, contentType: row.mimeType, filename: row.originalFilename };
}
