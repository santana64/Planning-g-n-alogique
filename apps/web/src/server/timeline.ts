import 'server-only';
import { cache } from 'react';
import {
  dateToJdn,
  formatGenealogicalDate,
  formatYearOnly,
  intervalWidthDays,
} from '@chronolignee/domain';
import { loadGenealogyGraph } from '@chronolignee/db';
import { ganttLinks, layoutGantt, type GanttLink } from '@chronolignee/engine';
import { lifespanEdges, type EdgeCertainty } from '@chronolignee/ui';
import { db } from '@/lib/db';
import { redactPerson, resolveTreeAccess } from './access';

/**
 * The timeline snapshot.
 *
 * Everything here crosses the server/client boundary, so it is plain data:
 * no class instances, no Map, no Date. The graph and the layout are computed
 * on the server where the database is, and the client receives only what it
 * has to draw.
 *
 * Certainty is resolved here too rather than in the renderer. The renderer
 * should not be re-deriving "is this edge known or inferred" on every frame,
 * and more importantly there should be exactly one place that decides it.
 */

export interface TimelineRow {
  readonly personId: string;
  readonly displayName: string;
  readonly row: number;
  readonly depth: number;
  readonly branchKey: string;
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
  /**
   * The birth and death windows, separately.
   *
   * The resolved lifespan is not enough to answer "was this person alive on
   * D": that needs to know how far the birth could be late and how early the
   * death could be, which is exactly the difference between YES and MAYBE.
   * Sent to the client so dragging the time cursor is instant rather than a
   * round trip per day.
   */
  readonly birthEarliestJdn: number | null;
  readonly birthLatestJdn: number | null;
  readonly deathEarliestJdn: number | null;
  readonly deathLatestJdn: number | null;
  readonly startCertainty: EdgeCertainty;
  readonly endCertainty: EdgeCertainty;
  readonly isLiving: boolean;
  /** Pre-rendered for the accessible table and for tooltips. */
  readonly birthLabel: string;
  readonly deathLabel: string;
  readonly lifespanLabel: string;
  /** True when this viewer may not see who this is. */
  readonly redacted: boolean;
}

export interface TimelineEvent {
  readonly id: string;
  readonly row: number;
  readonly jdn: number;
  readonly type: string;
  readonly label: string;
}

export interface TimelineBand {
  readonly id: string;
  readonly title: string;
  readonly startJdn: number;
  readonly endJdn: number;
  readonly category: string;
  readonly significance: number;
}

export interface TimelineSnapshot {
  readonly treeId: string;
  readonly treeName: string;
  readonly treeSlug: string;
  readonly rows: readonly TimelineRow[];
  readonly links: readonly GanttLink[];
  readonly events: readonly TimelineEvent[];
  readonly bands: readonly TimelineBand[];
  readonly earliestJdn: number;
  readonly latestJdn: number;
  readonly todayJdn: number;
  /** True when the event list was capped; the view says so rather than lying. */
  readonly eventsTruncated: boolean;
}

/**
 * Event markers are capped.
 *
 * A tree with twenty thousand people has on the order of a hundred thousand
 * events, which is more than a canvas can usefully draw and far more than
 * anyone can read. The cap is honest rather than silent: the view reports that
 * markers are partial, and zooming in reloads the window.
 */
const MAX_EVENT_MARKERS = 4000;

/** Event types worth a marker on a lifespan bar. */
const MARKER_EVENT_TYPES = [
  'BIRTH',
  'BAPTISM',
  'MARRIAGE',
  'DIVORCE',
  'MIGRATION',
  'NATURALIZATION',
  'MILITARY_SERVICE',
  'CENSUS',
  'DEATH',
  'BURIAL',
] as const;

export const loadTimeline = cache(async (treeSlug: string): Promise<TimelineSnapshot | null> => {
  // Authorisation first, and from the database. A viewer who may not see this
  // tree gets nothing — not a filtered version, not an empty shell.
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;
  const tree = { id: access.treeId, name: access.treeName, slug: access.treeSlug };

  const todayJdn = dateToJdn(new Date());
  const graph = await loadGenealogyGraph(db, tree.id, todayJdn);
  const layout = layoutGantt(graph);

  const rows: TimelineRow[] = layout.rows.map((row) => {
    const person = graph.people.get(row.personId);
    const birth = person?.birth ?? null;
    const death = person?.death ?? null;

    const edges = lifespanEdges({
      birthWindowDays: birth ? intervalWidthDays(birth.interval) : null,
      deathWindowDays: death ? intervalWidthDays(death.interval) : null,
      // The upper bound is inferred whenever no death was recorded but the
      // lifespan still has an end — the maximum-lifespan rule supplied it.
      endIsInferred: (death?.interval.latest ?? null) === null && (row.latestJdn ?? null) !== null,
      hasBirth: (birth?.interval.earliest ?? null) !== null,
      hasDeath: (death?.interval.earliest ?? null) !== null,
    });

    const birthLabel = birth ? formatGenealogicalDate(birth) : '—';
    const deathLabel = death ? formatGenealogicalDate(death) : '—';

    return redactPerson(
      {
        personId: row.personId,
        displayName: person?.displayName ?? '',
        row: row.row,
        depth: row.depth,
        branchKey: row.branchKey,
        earliestJdn: row.earliestJdn,
        latestJdn: row.latestJdn,
        birthEarliestJdn: birth?.interval.earliest ?? null,
        birthLatestJdn: birth?.interval.latest ?? null,
        deathEarliestJdn: death?.interval.earliest ?? null,
        deathLatestJdn: death?.interval.latest ?? null,
        startCertainty: edges.start,
        endCertainty: edges.end,
        isLiving: person?.isDeceased === false,
        birthLabel,
        deathLabel,
        lifespanLabel: `${formatYearOnly(birth)} – ${
          person?.isDeceased === false ? '' : formatYearOnly(death)
        }`.trim(),
        redacted: false,
      },
      access.redactLiving,
    );
  });

  const eventRows = await db.event.findMany({
    where: {
      treeId: tree.id,
      deletedAt: null,
      type: { in: [...MARKER_EVENT_TYPES] },
      dateSortJdn: { not: null },
    },
    select: {
      id: true,
      type: true,
      dateSortJdn: true,
      description: true,
      participants: { select: { personId: true }, take: 1 },
    },
    orderBy: { dateSortJdn: 'asc' },
    take: MAX_EVENT_MARKERS + 1,
  });

  const eventsTruncated = eventRows.length > MAX_EVENT_MARKERS;
  const events: TimelineEvent[] = [];

  // Rows whose person is redacted. Their event markers must be dropped too:
  // redacting a name while still plotting that person's birth marker on the
  // axis leaks the date the redaction was supposed to protect.
  const redactedRows = new Set(rows.filter((r) => r.redacted).map((r) => r.row));

  for (const event of eventRows.slice(0, MAX_EVENT_MARKERS)) {
    const personId = event.participants[0]?.personId;
    const row = personId ? layout.rowByPersonId.get(personId) : undefined;
    if (row === undefined || event.dateSortJdn === null) continue;
    if (redactedRows.has(row)) continue;
    events.push({
      id: event.id,
      row,
      jdn: event.dateSortJdn,
      type: event.type,
      label: event.description ?? event.type,
    });
  }

  const bandRows = await db.treeHistoricalEvent.findMany({
    where: { treeId: tree.id },
    select: {
      historicalEvent: {
        select: {
          id: true,
          title: true,
          startJdn: true,
          endJdn: true,
          category: true,
          significance: true,
        },
      },
    },
  });

  const bands: TimelineBand[] = bandRows.map((entry) => ({
    id: entry.historicalEvent.id,
    title: entry.historicalEvent.title,
    startJdn: entry.historicalEvent.startJdn,
    endJdn: entry.historicalEvent.endJdn,
    category: entry.historicalEvent.category,
    significance: entry.historicalEvent.significance,
  }));

  // Fall back to a sane window when the tree has no dated people at all,
  // rather than handing the camera a null extent to divide by.
  const earliestJdn = layout.earliestJdn ?? todayJdn - 36_525;
  const latestJdn = layout.latestJdn ?? todayJdn;

  // A parent link is positioned at the child's birth, so a link into a
  // redacted child leaks that birth date just as an event marker would.
  const allLinks = ganttLinks(graph, layout);
  const links = access.redactLiving
    ? allLinks.filter((link) => !redactedRows.has(link.toRow) && !redactedRows.has(link.fromRow))
    : allLinks;

  return {
    treeId: tree.id,
    treeName: tree.name,
    treeSlug: tree.slug,
    rows,
    links,
    events,
    bands,
    earliestJdn,
    latestJdn,
    todayJdn,
    eventsTruncated,
  };
});
