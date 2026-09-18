/**
 * What a star looks like, and where it sits in depth.
 *
 * Kept apart from the renderer so the encoding — the part that makes claims
 * about the record — can be tested without a GPU. Brightness is evidence:
 * the share of a person's own events that a citation supports. Depth is time:
 * years from their birth to today, the present nearest the viewer.
 */

import type { ConstellationStar } from '@/server/constellation';

/** The night sky is the same in both themes: stars need the dark to be read as light. */
export const SKY = {
  background: '#0b1020',
  star: '#f3ead8',
  focus: '#f0b35a',
  hidden: '#7d8799',
  parentLink: '#6f86a8',
  otherParentLink: '#4a5870',
  partnerLink: '#b08a5a',
  guide: '#34415e',
} as const;

/** Scene units per year in the depth mode. The rings are ten units apart. */
export const DEPTH_UNITS_PER_YEAR = 0.2;

export const RING_SPACING = 10;

export type ConstellationMode = 'plan' | 'depth';

/** Hidden people are drawn, but faintly and without any claim about their record. */
const HIDDEN_BRIGHTNESS = 0.22;
/** Nothing recorded: not the same as recorded and unsourced, but just as dim. */
const NOTHING_RECORDED_BRIGHTNESS = 0.3;
const UNSOURCED_BRIGHTNESS = 0.38;

export function starBrightness(star: Pick<ConstellationStar, 'hidden' | 'coverage'>): number {
  if (star.hidden) return HIDDEN_BRIGHTNESS;
  if (star.coverage === null) return NOTHING_RECORDED_BRIGHTNESS;
  const coverage = Math.min(1, Math.max(0, star.coverage));
  return UNSOURCED_BRIGHTNESS + (1 - UNSOURCED_BRIGHTNESS) * coverage;
}

/**
 * Core size in CSS pixels, before the halo. Large enough for brightness to
 * be read as brightness: on a two-pixel dot, an unsourced star and a fully
 * sourced one are the same speck.
 */
export function starSize(star: Pick<ConstellationStar, 'hidden'>, isFocus: boolean): number {
  if (isFocus) return 10;
  return star.hidden ? 4 : 6.5;
}

/**
 * The z of a star in a mode, or null when it has no place there.
 *
 * In the plan every star lies in one plane. In depth, a person with no known
 * birth — or one the viewer may not see — is not given a depth at all: any
 * value would be a date nobody recorded, or one somebody is entitled to keep.
 */
export function starDepth(
  star: Pick<ConstellationStar, 'yearsBefore'>,
  mode: ConstellationMode,
): number | null {
  if (mode === 'plan') return 0;
  if (star.yearsBefore === null) return null;
  return -star.yearsBefore * DEPTH_UNITS_PER_YEAR;
}

/** The two ends of a birth range in depth, when the range is wide enough to see. */
export function uncertaintySpan(
  star: Pick<ConstellationStar, 'yearsBeforeEarliest' | 'yearsBeforeLatest'>,
): { readonly near: number; readonly far: number } | null {
  const { yearsBeforeEarliest: earliest, yearsBeforeLatest: latest } = star;
  if (earliest === null && latest === null) return null;
  // A one-sided bound ("avant 1750") runs a fixed distance past its known end,
  // as the temporal fan's open bands do, rather than inventing the other end.
  const OPEN_RUN_YEARS = 15;
  const far = earliest ?? (latest as number) + OPEN_RUN_YEARS;
  const near = latest ?? Math.max(0, (earliest as number) - OPEN_RUN_YEARS);
  if (Math.abs(far - near) < 2) return null;
  return { near: -near * DEPTH_UNITS_PER_YEAR, far: -far * DEPTH_UNITS_PER_YEAR };
}

/**
 * Century planes spanning the people placed in depth: the guides that make
 * "looking into centuries" literal. From the first century boundary after the
 * earliest birth to the last one before today.
 */
export function centuryGuides(
  stars: readonly Pick<ConstellationStar, 'yearsBefore'>[],
  presentYear: number,
): { readonly year: number; readonly z: number }[] {
  const placed = stars
    .map((star) => star.yearsBefore)
    .filter((value): value is number => value !== null);
  if (placed.length === 0) return [];
  const earliestYear = presentYear - Math.max(...placed);
  const guides: { year: number; z: number }[] = [];
  for (let year = Math.ceil(earliestYear / 100) * 100; year <= presentYear; year += 100) {
    guides.push({ year, z: -(presentYear - year) * DEPTH_UNITS_PER_YEAR });
  }
  return guides;
}

/** Placing a name comes before the scene is turned: the focus, then the nearest. */
export function labelPriority(
  star: Pick<ConstellationStar, 'hop' | 'coverage'>,
  isFocus: boolean,
  isHovered: boolean,
): number {
  if (isHovered) return 10_000;
  if (isFocus) return 5_000;
  return 1_000 - star.hop * 100 + Math.round((star.coverage ?? 0) * 50);
}

export function coverageSentence(star: Pick<ConstellationStar, 'events' | 'cited'>): string {
  if (star.events === 0) return 'aucun événement enregistré';
  if (star.cited === 0) {
    return star.events === 1
      ? '1 événement, non sourcé'
      : `${star.events} événements, aucun sourcé`;
  }
  return `${star.cited} événement${star.cited > 1 ? 's' : ''} sourcé${star.cited > 1 ? 's' : ''} sur ${star.events}`;
}

export function hopSentence(hop: number): string {
  if (hop === 0) return 'personne centrale';
  return hop === 1 ? 'à 1 lien' : `à ${hop} liens`;
}
