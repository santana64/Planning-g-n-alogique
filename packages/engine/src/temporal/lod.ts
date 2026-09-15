import { pixelsPerYear, type TemporalViewport } from './scale';

/**
 * Level of detail.
 *
 * A genealogy of twenty thousand people cannot be drawn as twenty thousand
 * labelled bars, and shrinking everything until it fits produces a grey smear
 * that carries no information at all. So detail is a function of scale: what
 * the viewport can actually resolve decides what gets drawn, and the rest is
 * aggregated rather than crushed.
 *
 * The thresholds are expressed in pixels per year, which is the only unit that
 * makes them independent of screen size and data extent.
 */

export const DETAIL_LEVELS = [
  /** Centuries and branch masses. Individual lives are not resolvable. */
  'CENTURY',
  /** Branch summaries: how many people, spanning which years. */
  'BRANCH',
  /** Generation bands. */
  'GENERATION',
  /** One bar per person, no labels. */
  'PERSON',
  /** Bars with names, and event markers on them. */
  'EVENT',
  /** Everything, including sources and document markers. */
  'DETAIL',
] as const;

export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export interface LodDecision {
  readonly level: DetailLevel;
  readonly showPersonBars: boolean;
  readonly showPersonLabels: boolean;
  readonly showEventMarkers: boolean;
  readonly showEventLabels: boolean;
  readonly showRelationshipLinks: boolean;
  readonly showSourceMarkers: boolean;
  readonly showHistoricalBands: boolean;
  /** Bars narrower than this are not worth drawing individually. */
  readonly minBarWidthPx: number;
}

export interface LodInput {
  readonly viewport: TemporalViewport;
  /** Vertical space per person, in pixels. */
  readonly rowHeightPx: number;
  /** How many people are in the current projection. */
  readonly personCount: number;
}

/** Pixels per year at which each level takes over. */
const THRESHOLDS: ReadonlyArray<{ level: DetailLevel; minPixelsPerYear: number }> = [
  { level: 'DETAIL', minPixelsPerYear: 120 },
  { level: 'EVENT', minPixelsPerYear: 14 },
  { level: 'PERSON', minPixelsPerYear: 2.5 },
  { level: 'GENERATION', minPixelsPerYear: 0.8 },
  { level: 'BRANCH', minPixelsPerYear: 0.25 },
  { level: 'CENTURY', minPixelsPerYear: 0 },
];

/**
 * A row shorter than this cannot carry a legible name, whatever the horizontal
 * zoom. Vertical crowding forces aggregation just as horizontal crowding does.
 */
const MIN_LABEL_ROW_HEIGHT_PX = 11;

/**
 * Above this many visible people, labels are suppressed regardless of zoom.
 * Not a rendering cost concern — a wall of overlapping names is simply
 * unreadable, and the user is better served by bars alone plus a search.
 */
const MAX_LABELLED_PEOPLE = 400;

export function decideLod(input: LodInput): LodDecision {
  const perYear = pixelsPerYear(input.viewport);

  const level =
    THRESHOLDS.find((threshold) => perYear >= threshold.minPixelsPerYear)?.level ?? 'CENTURY';

  const rank = DETAIL_LEVELS.indexOf(level);
  const atLeast = (target: DetailLevel): boolean => rank >= DETAIL_LEVELS.indexOf(target);

  const roomForLabels =
    input.rowHeightPx >= MIN_LABEL_ROW_HEIGHT_PX && input.personCount <= MAX_LABELLED_PEOPLE;

  return {
    level,
    showPersonBars: atLeast('PERSON'),
    showPersonLabels: atLeast('EVENT') && roomForLabels,
    showEventMarkers: atLeast('EVENT'),
    showEventLabels: atLeast('DETAIL') && roomForLabels,
    // Links stay on one level longer than labels: a relationship line is thin
    // enough to survive crowding, and it is the thing that makes the view a
    // genealogy rather than a list of bars.
    showRelationshipLinks: atLeast('PERSON'),
    showSourceMarkers: atLeast('DETAIL'),
    // The historical layer is always available; it is background, and it is
    // most useful precisely when zoomed out far enough to see a century.
    showHistoricalBands: true,
    minBarWidthPx: atLeast('EVENT') ? 1 : 2,
  };
}

/**
 * Thin out labels so they do not collide.
 *
 * Takes items already sorted by x and keeps the ones that clear the previous
 * kept label. Greedy and left-to-right on purpose: it is stable frame to frame,
 * so a label does not flicker in and out as the camera drifts by a pixel — the
 * artefact that makes a "smarter" scoring pass feel broken in motion.
 */
export function cullLabels<T>(
  items: readonly T[],
  xOf: (item: T) => number,
  widthOf: (item: T) => number,
  gapPx = 8,
): T[] {
  const kept: T[] = [];
  let occupiedUntil = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const x = xOf(item);
    if (x < occupiedUntil) continue;
    kept.push(item);
    occupiedUntil = x + widthOf(item) + gapPx;
  }
  return kept;
}
