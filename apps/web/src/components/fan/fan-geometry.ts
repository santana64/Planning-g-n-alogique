/**
 * Turning a temporal fan layout into SVG paths.
 *
 * The layout speaks in fractions of the sweep and years before the centre;
 * this speaks in pixels. Kept apart from the component so the arithmetic that
 * decides where an ancestor is drawn can be tested without a browser.
 *
 * The fan opens downward: the father's side on the left, the mother's on the
 * right, the oldest generations at the top — the orientation genealogists
 * read fan charts in.
 */

export const FAN = {
  size: 800,
  cx: 400,
  cy: 430,
  /** The disc at the centre is the subject. */
  rInner: 48,
  rOuter: 372,
  /** Degrees, clockwise from the positive x axis, as SVG draws them. */
  startDeg: 135,
  sweepDeg: 270,
  /** An exact date is a hairline in time; it still has to be visible. */
  minBandPx: 2.5,
  /** How far an open-ended band runs past its known edge before fading out. */
  openRunPx: 22,
} as const;

export function angleAt(fraction: number): number {
  return ((FAN.startDeg + fraction * FAN.sweepDeg) * Math.PI) / 180;
}

export function point(radius: number, angle: number): [number, number] {
  return [FAN.cx + radius * Math.cos(angle), FAN.cy + radius * Math.sin(angle)];
}

/** Years before the centre, to a radius; the outermost ring sets the scale. */
export function radiusFor(years: number, scaleYears: number): number {
  if (scaleYears <= 0) return FAN.rInner;
  const clamped = Math.max(0, years);
  return FAN.rInner + (clamped / scaleYears) * (FAN.rOuter - FAN.rInner);
}

function fixed(value: number): string {
  return value.toFixed(2);
}

/**
 * An annular sector: the ring between two radii, between two angles.
 *
 * The large-arc flag is decided by the angle actually spanned. Getting it
 * wrong draws the long way round the circle — a sector that looks fine for a
 * narrow slice and turns into a near-complete disc for a wide one, which is
 * exactly the parents' sectors, the widest on the chart.
 */
export function annularSector(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x1, y1] = point(outerRadius, startAngle);
  const [x2, y2] = point(outerRadius, endAngle);
  const [x3, y3] = point(innerRadius, endAngle);
  const [x4, y4] = point(innerRadius, startAngle);
  return [
    `M ${fixed(x1)} ${fixed(y1)}`,
    `A ${fixed(outerRadius)} ${fixed(outerRadius)} 0 ${large} 1 ${fixed(x2)} ${fixed(y2)}`,
    `L ${fixed(x3)} ${fixed(y3)}`,
    `A ${fixed(innerRadius)} ${fixed(innerRadius)} 0 ${large} 0 ${fixed(x4)} ${fixed(y4)}`,
    'Z',
  ].join(' ');
}

/** An open arc along one radius, for the year guides. */
export function arc(radius: number, startAngle: number, endAngle: number): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x1, y1] = point(radius, startAngle);
  const [x2, y2] = point(radius, endAngle);
  return `M ${fixed(x1)} ${fixed(y1)} A ${fixed(radius)} ${fixed(radius)} 0 ${large} 1 ${fixed(x2)} ${fixed(y2)}`;
}

/** The names written along the bands. */
export const LABEL = {
  fontSize: 10,
  /** A deliberately generous average glyph width: a name that might not fit is left off. */
  charWidth: 5.8,
  /** Between a band's outer edge and the baseline of its name. */
  gap: 4,
  /** Kept clear at each end of the arc, so neighbouring names never touch. */
  padding: 6,
} as const;

/**
 * The path a name is written along.
 *
 * Text follows the direction of its path. Drawn clockwise like everything
 * else, a name on the lower half of the fan would read upside down; there the
 * path runs the other way, and `flipped` tells the caller to hang the text
 * below it so the name still sits outside its band rather than across it.
 */
export function labelPath(
  radius: number,
  startAngle: number,
  endAngle: number,
): { d: string; flipped: boolean } {
  const flipped = Math.sin((startAngle + endAngle) / 2) > 0;
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x1, y1] = point(radius, flipped ? endAngle : startAngle);
  const [x2, y2] = point(radius, flipped ? startAngle : endAngle);
  return {
    d: `M ${fixed(x1)} ${fixed(y1)} A ${fixed(radius)} ${fixed(radius)} 0 ${large} ${flipped ? 0 : 1} ${fixed(x2)} ${fixed(y2)}`,
    flipped,
  };
}

/**
 * Whether a name fits along its arc.
 *
 * A name that does not fit is left off rather than cut: text on a path is
 * silently clipped at the path's end, and "Pierre CHASS" names nobody.
 */
export function labelFits(
  text: string,
  radius: number,
  startAngle: number,
  endAngle: number,
): boolean {
  const available = radius * (endAngle - startAngle) - 2 * LABEL.padding;
  return text.length > 0 && text.length * LABEL.charWidth <= available;
}

export interface BandRadii {
  readonly inner: number;
  readonly outer: number;
}

/**
 * The radii a band is drawn between.
 *
 * Open ends run a short way past the known edge instead of stopping, so "avant
 * 1750" visibly has no outer boundary; and a hairline gets a minimum width so
 * that certainty is not the same as invisibility.
 */
export function bandRadii(
  sector: {
    readonly innerYears: number;
    readonly outerYears: number;
    readonly innerOpen: boolean;
    readonly outerOpen: boolean;
  },
  scaleYears: number,
): BandRadii {
  let inner = radiusFor(sector.innerYears, scaleYears);
  let outer = radiusFor(sector.outerYears, scaleYears);

  if (sector.outerOpen) outer = Math.min(FAN.rOuter, outer + FAN.openRunPx);
  if (sector.innerOpen) inner = Math.max(FAN.rInner, inner - FAN.openRunPx);

  if (outer - inner < FAN.minBandPx) {
    const middle = (inner + outer) / 2;
    inner = Math.max(FAN.rInner, middle - FAN.minBandPx / 2);
    outer = inner + FAN.minBandPx;
  }
  return { inner, outer };
}
