import { DAYS_PER_YEAR, gregorianToJdn, jdnToGregorian } from '@chronolignee/domain';

/**
 * The temporal axis.
 *
 * One mapping, in one place: Julian Day Number to horizontal pixel. Everything
 * that draws on the timeline — lifespan bars, event markers, the today line,
 * the historical bands behind them — goes through this, so nothing can end up
 * a few pixels out of register with anything else.
 *
 * The axis is linear in days rather than in years. That matters: a linear-in-
 * years axis would make a life spanning a leap year microscopically longer
 * than the same life a year later, and at deep zoom the error is visible.
 */

export interface TemporalViewport {
  /** Leftmost visible day. */
  readonly startJdn: number;
  /** Rightmost visible day. */
  readonly endJdn: number;
  readonly widthPx: number;
}

export function daysPerPixel(viewport: TemporalViewport): number {
  const span = viewport.endJdn - viewport.startJdn;
  return span / Math.max(viewport.widthPx, 1);
}

export function pixelsPerYear(viewport: TemporalViewport): number {
  return DAYS_PER_YEAR / daysPerPixel(viewport);
}

export function jdnToX(viewport: TemporalViewport, jdn: number): number {
  const span = viewport.endJdn - viewport.startJdn;
  if (span <= 0) return 0;
  return ((jdn - viewport.startJdn) / span) * viewport.widthPx;
}

export function xToJdn(viewport: TemporalViewport, x: number): number {
  const span = viewport.endJdn - viewport.startJdn;
  return viewport.startJdn + (x / Math.max(viewport.widthPx, 1)) * span;
}

/**
 * Where to draw an unbounded edge.
 *
 * A life with no recorded death has no right-hand coordinate. Rather than
 * inventing one, the caller is told to run the bar off the edge of the
 * viewport and fade it — which is what an unknown boundary actually looks
 * like. Returning a number here would be the fake precision the product
 * exists to avoid.
 */
export interface BarGeometry {
  readonly x: number;
  readonly width: number;
  /** True when the left edge is off-screen because the date is unbounded. */
  readonly openLeft: boolean;
  readonly openRight: boolean;
  /** False when the interval does not intersect the viewport at all. */
  readonly visible: boolean;
}

/** How far past the viewport an open-ended bar is drawn, in pixels. */
const OPEN_EDGE_OVERSHOOT = 64;

export function barGeometry(
  viewport: TemporalViewport,
  interval: { earliest: number | null; latest: number | null },
): BarGeometry {
  const { earliest, latest } = interval;

  // Nothing known at either end: there is no bar to draw.
  if (earliest === null && latest === null) {
    return { x: 0, width: 0, openLeft: true, openRight: true, visible: false };
  }

  const openLeft = earliest === null;
  const openRight = latest === null;

  const leftX = openLeft ? -OPEN_EDGE_OVERSHOOT : jdnToX(viewport, earliest);
  const rightX = openRight ? viewport.widthPx + OPEN_EDGE_OVERSHOOT : jdnToX(viewport, latest);

  const visible = rightX >= -OPEN_EDGE_OVERSHOOT && leftX <= viewport.widthPx + OPEN_EDGE_OVERSHOOT;

  return {
    x: leftX,
    // A single-day life still needs a pixel, or a birth-and-death-same-day
    // infant vanishes from the timeline entirely.
    width: Math.max(rightX - leftX, 1),
    openLeft,
    openRight,
    visible,
  };
}

// --- Tick marks -------------------------------------------------------------

export const TICK_UNITS = ['MILLENNIUM', 'CENTURY', 'DECADE', 'YEAR', 'MONTH', 'DAY'] as const;
export type TickUnit = (typeof TICK_UNITS)[number];

interface TickSpec {
  readonly unit: TickUnit;
  /** Step in units of that kind (5 decades, 10 years, ...). */
  readonly step: number;
  readonly approximateDays: number;
}

/**
 * Candidate rulings, coarse to fine.
 *
 * Only round steps appear: nobody reads a timeline ruled every 37 years. The
 * chosen ruling is the coarsest whose spacing still exceeds the minimum
 * legible gap, which keeps labels from colliding at any zoom without any
 * per-frame measurement.
 */
const TICK_SPECS: readonly TickSpec[] = [
  { unit: 'MILLENNIUM', step: 1, approximateDays: 1000 * DAYS_PER_YEAR },
  { unit: 'CENTURY', step: 5, approximateDays: 500 * DAYS_PER_YEAR },
  { unit: 'CENTURY', step: 1, approximateDays: 100 * DAYS_PER_YEAR },
  { unit: 'DECADE', step: 5, approximateDays: 50 * DAYS_PER_YEAR },
  { unit: 'DECADE', step: 1, approximateDays: 10 * DAYS_PER_YEAR },
  { unit: 'YEAR', step: 5, approximateDays: 5 * DAYS_PER_YEAR },
  { unit: 'YEAR', step: 1, approximateDays: DAYS_PER_YEAR },
  { unit: 'MONTH', step: 3, approximateDays: 91 },
  { unit: 'MONTH', step: 1, approximateDays: 30 },
  { unit: 'DAY', step: 7, approximateDays: 7 },
  { unit: 'DAY', step: 1, approximateDays: 1 },
];

export interface Tick {
  readonly jdn: number;
  readonly x: number;
  readonly unit: TickUnit;
  /** True for the first tick of a coarser unit — a century inside decades. */
  readonly major: boolean;
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Ticks covering the viewport.
 *
 * @param minSpacingPx the narrowest gap a label stays readable at.
 */
export function temporalTicks(viewport: TemporalViewport, minSpacingPx = 72): Tick[] {
  const perDay = 1 / daysPerPixel(viewport);

  // Search from the FINEST end and take the first ruling whose spacing still
  // clears the minimum. Searching from the coarse end instead returns the
  // first that merely fits, which for a century-wide view is "millennia" — a
  // ruling with no marks anywhere inside it.
  let spec: TickSpec | undefined;
  for (let i = TICK_SPECS.length - 1; i >= 0; i -= 1) {
    const candidate = TICK_SPECS[i];
    if (candidate && candidate.approximateDays * perDay >= minSpacingPx) {
      spec = candidate;
      break;
    }
  }
  // Nothing clears the gap: the view is wider than a millennium, so use the
  // coarsest ruling and accept that labels may be sparse.
  spec ??= TICK_SPECS[0];
  if (!spec) return [];

  const from = jdnToGregorian(Math.floor(viewport.startJdn));
  const to = jdnToGregorian(Math.ceil(viewport.endJdn));
  const ticks: Tick[] = [];

  if (spec.unit === 'DAY') {
    // Day ticks step by whole days, so they are generated on the JDN axis
    // directly rather than through calendar arithmetic.
    const start = Math.ceil(viewport.startJdn / spec.step) * spec.step;
    for (let jdn = start; jdn <= viewport.endJdn; jdn += spec.step) {
      const parts = jdnToGregorian(jdn);
      ticks.push({
        jdn,
        x: jdnToX(viewport, jdn),
        unit: 'DAY',
        major: parts.day === 1,
        ...parts,
      });
    }
    return ticks;
  }

  if (spec.unit === 'MONTH') {
    let year = from.year;
    let month = Math.floor((from.month - 1) / spec.step) * spec.step + 1;
    while (true) {
      const jdn = gregorianToJdn(year, month, 1);
      if (jdn > viewport.endJdn) break;
      if (jdn >= viewport.startJdn) {
        ticks.push({
          jdn,
          x: jdnToX(viewport, jdn),
          unit: 'MONTH',
          major: month === 1,
          year,
          month,
          day: 1,
        });
      }
      month += spec.step;
      if (month > 12) {
        month -= 12;
        year += 1;
      }
    }
    return ticks;
  }

  const yearsPerStep =
    spec.unit === 'MILLENNIUM'
      ? 1000 * spec.step
      : spec.unit === 'CENTURY'
        ? 100 * spec.step
        : spec.unit === 'DECADE'
          ? 10 * spec.step
          : spec.step;

  const firstYear = Math.floor(from.year / yearsPerStep) * yearsPerStep;
  for (let year = firstYear; year <= to.year; year += yearsPerStep) {
    const jdn = gregorianToJdn(year, 1, 1);
    if (jdn < viewport.startJdn || jdn > viewport.endJdn) continue;
    ticks.push({
      jdn,
      x: jdnToX(viewport, jdn),
      unit: spec.unit,
      // A century line inside a decade ruling gets more weight, which is what
      // lets the eye find 1800 without reading every label.
      major: year % (yearsPerStep * 10) === 0 || year % 100 === 0,
      year,
      month: 1,
      day: 1,
    });
  }
  return ticks;
}
