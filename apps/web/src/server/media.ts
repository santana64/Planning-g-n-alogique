import 'server-only';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import { dateToJdn, jdnToGregorian } from '@chronolignee/domain';
import { decodeDate } from '@chronolignee/db';
import { db } from '@/lib/db';
import { hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';
import { treeGraph } from './graph-cache';
import { dateLabelOf } from './people';

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
  /** The people recognised in it, by identifier. */
  readonly taggedIds: readonly string[];
  /** The events it is said to show. */
  readonly eventIds: readonly string[];
  readonly processed: boolean;
}

/** An event a photograph shows, or could be said to show. */
export interface PhotoEvent {
  readonly eventId: string;
  readonly label: string;
  readonly dateLabel: string | null;
  readonly people: readonly string[];
}

export interface PhotoDetail extends PhotoCard {
  readonly description: string | null;
  readonly copyright: string | null;
  readonly capturedOriginalText: string | null;
  readonly originalFilename: string;
  readonly tags: readonly PhotoTag[];
  readonly events: readonly PhotoEvent[];
  /** Events of the people in it, not yet linked — offered to editors only. */
  readonly linkableEvents: readonly PhotoEvent[];
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
  events: { select: { eventId: true } },
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
  events: Array<{ eventId: string }>;
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
    taggedIds: row.personTags.map((tag) => tag.personId),
    eventIds: row.events.map((link) => link.eventId),
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

  const linked = row.events.map((link) => link.eventId);
  const tagged = row.personTags.map((tag) => tag.personId);
  const [events, linkableEvents] = await Promise.all([
    photoEvents(access, { id: { in: linked } }, visible, nameOf),
    access.canEdit && tagged.length > 0
      ? photoEvents(
          access,
          { id: { notIn: linked }, participants: { some: { personId: { in: tagged } } } },
          visible,
          nameOf,
        )
      : Promise.resolve([]),
  ]);

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
    events,
    linkableEvents,
  };
  return { access, photo, people };
});

/**
 * Events in words, for the photograph page: kind, people, date as written.
 *
 * An event with anyone in it this reader may not see is left out — its
 * existence beside a photograph would say who else was there.
 */
async function photoEvents(
  access: TreeAccess,
  where: NonNullable<NonNullable<Parameters<typeof db.event.findMany>[0]>['where']>,
  visible: (personId: string) => boolean,
  nameOf: (personId: string) => string,
): Promise<PhotoEvent[]> {
  const rows = await db.event.findMany({
    where: { ...where, treeId: access.treeId, deletedAt: null },
    select: {
      id: true,
      type: true,
      customType: true,
      dateQualifier: true,
      dateCalendar: true,
      datePrecision: true,
      dateStartYear: true,
      dateStartMonth: true,
      dateStartDay: true,
      dateEndYear: true,
      dateEndMonth: true,
      dateEndDay: true,
      dateOriginalText: true,
      dateUnparsed: true,
      participants: { select: { personId: true } },
    },
    orderBy: [{ dateSortJdn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 80,
  });
  if (rows.length === 0) return [];
  const kinds = await getTranslations('events');
  return rows
    .filter((row) => row.participants.every((participant) => visible(participant.personId)))
    .map((row) => ({
      eventId: row.id,
      label:
        row.type === 'CUSTOM'
          ? (row.customType ?? kinds('CUSTOM'))
          : kinds.has(row.type)
            ? kinds(row.type)
            : row.type,
      dateLabel: row.dateQualifier ? dateLabelOf(decodeDate(row), row.dateOriginalText) : null,
      people: [...new Set(row.participants.map((participant) => nameOf(participant.personId)))],
    }));
}

/**
 * The photographs of one person's life, for their record: those they have
 * been recognised in, and those said to show one of their events.
 */
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
      OR: [
        { personTags: { some: { personId } } },
        { events: { some: { event: { deletedAt: null, participants: { some: { personId } } } } } },
      ],
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
