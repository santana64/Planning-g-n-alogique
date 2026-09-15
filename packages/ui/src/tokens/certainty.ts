/**
 * The visual language of uncertainty.
 *
 * Principle 2 says uncertainty must remain visible; principle 12 says no fake
 * precision. Together they mean a lifespan bar cannot simply be a rectangle:
 * its edges have to say how much we actually know about where they fall.
 *
 * Every distinction below is encoded twice — once in colour, once in shape or
 * opacity — so it survives greyscale, colour-blindness and a one-pixel line
 * on a dark ground. Colour alone would fail WCAG 2.2 and, more to the point,
 * would fail the researcher squinting at a dense century.
 */

export type EdgeCertainty =
  /** A recorded date, precise to the day. Hard edge. */
  | 'EXACT'
  /** Recorded but imprecise: a month, a year, a "between". Tapered edge. */
  | 'APPROXIMATE'
  /** Not recorded; derived arithmetically (the maximum-lifespan rule). Fades out. */
  | 'INFERRED'
  /** Nothing is known on this side. Dissolves entirely. */
  | 'UNKNOWN';

export interface EdgeStyle {
  readonly color: string;
  /** Fraction of the bar over which the edge fades. 0 is a hard edge. */
  readonly featherFraction: number;
  /** Dash pattern in pixels. Empty is solid. */
  readonly dashArray: readonly number[];
  readonly opacity: number;
  /** Key for the translated legend entry. */
  readonly labelKey: string;
}

export const EDGE_STYLES: Record<EdgeCertainty, EdgeStyle> = {
  EXACT: {
    color: 'var(--certainty-exact)',
    featherFraction: 0,
    dashArray: [],
    opacity: 1,
    labelKey: 'certainty.exact',
  },
  APPROXIMATE: {
    color: 'var(--certainty-approximate)',
    // Enough taper to read as soft without making the bar look shorter than
    // the evidence supports.
    featherFraction: 0.12,
    dashArray: [3, 2],
    opacity: 0.92,
    labelKey: 'certainty.approximate',
  },
  INFERRED: {
    color: 'var(--certainty-inferred)',
    featherFraction: 0.35,
    dashArray: [2, 4],
    opacity: 0.6,
    labelKey: 'certainty.inferred',
  },
  UNKNOWN: {
    color: 'var(--certainty-unknown)',
    // Dissolves rather than ending. An open-ended life must not appear to stop
    // at the edge of a bar we chose arbitrarily.
    featherFraction: 0.6,
    dashArray: [1, 5],
    opacity: 0.38,
    labelKey: 'certainty.unknown',
  },
};

export interface LifespanEdges {
  readonly start: EdgeCertainty;
  readonly end: EdgeCertainty;
}

export interface LifespanEdgeInput {
  /** Width in days of the birth date's possible-window; null when unbounded. */
  readonly birthWindowDays: number | null;
  readonly deathWindowDays: number | null;
  /** True when the end came from the maximum-lifespan rule, not a record. */
  readonly endIsInferred: boolean;
  readonly hasBirth: boolean;
  readonly hasDeath: boolean;
}

/**
 * How wide a date's window may be before its edge stops reading as exact.
 * One day is exact; anything wider is a range we must not draw as a point.
 */
const EXACT_WINDOW_DAYS = 0;

export function lifespanEdges(input: LifespanEdgeInput): LifespanEdges {
  const start: EdgeCertainty = !input.hasBirth
    ? 'UNKNOWN'
    : input.birthWindowDays === null
      ? 'UNKNOWN'
      : input.birthWindowDays <= EXACT_WINDOW_DAYS
        ? 'EXACT'
        : 'APPROXIMATE';

  const end: EdgeCertainty = input.endIsInferred
    ? 'INFERRED'
    : !input.hasDeath
      ? 'UNKNOWN'
      : input.deathWindowDays === null
        ? 'UNKNOWN'
        : input.deathWindowDays <= EXACT_WINDOW_DAYS
          ? 'EXACT'
          : 'APPROXIMATE';

  return { start, end };
}

/** Trivalent answers, as used by "who was alive" result groupings. */
export type MembershipCertainty = 'CERTAIN' | 'POSSIBLE' | 'UNDATED';

export const MEMBERSHIP_STYLES: Record<
  MembershipCertainty,
  { readonly color: string; readonly opacity: number; readonly labelKey: string }
> = {
  CERTAIN: { color: 'var(--accent-primary)', opacity: 1, labelKey: 'membership.certain' },
  POSSIBLE: {
    color: 'var(--certainty-approximate)',
    opacity: 0.7,
    labelKey: 'membership.possible',
  },
  UNDATED: { color: 'var(--certainty-unknown)', opacity: 0.4, labelKey: 'membership.undated' },
};
