/**
 * The river: a family as streams that split, run on and dry up.
 *
 * Each branch — a line of descent from the place where a family first
 * divides, as the timeline already keys it — is a stream whose width at a
 * year is the number of its members alive then. Streams are laid side by
 * side around a common centre, each child branch next to the branch it
 * left, so a fork reads as a stream dividing and a line that dies out as one
 * narrowing to nothing.
 *
 * An exploratory reading, not a record: it says nothing a person's own page
 * does not, and it is never where a relationship is edited. Its widths are
 * counts of lives the reader may see, nothing inferred.
 */

export interface RiverRowInput {
  readonly personId: string;
  readonly branchKey: string;
  readonly earliestYear: number | null;
  readonly latestYear: number | null;
}

export interface RiverInput {
  readonly rows: readonly RiverRowInput[];
  /** The branch each branch left, by key; absent or null for a root. */
  readonly parentOf: ReadonlyMap<string, string | null>;
  /** Years between samples; the layout keeps at most `maxSamples` of them. */
  readonly stepYears?: number;
  readonly maxSamples?: number;
}

export interface RiverSample {
  readonly year: number;
  /** Edges of the stream, in people, around the river's centre line. */
  readonly y0: number;
  readonly y1: number;
}

export interface RiverStream {
  readonly branchKey: string;
  readonly people: number;
  readonly firstYear: number;
  readonly lastYear: number;
  /** Where the stream is widest, for its label. */
  readonly widestYear: number;
  readonly samples: readonly RiverSample[];
}

export interface RiverLayout {
  readonly streams: readonly RiverStream[];
  readonly fromYear: number;
  readonly toYear: number;
  /** The widest the whole river gets, in people. */
  readonly maxWidth: number;
}

/** Branches in an order where every child branch follows the one it left. */
function branchOrder(
  keys: readonly string[],
  parentOf: ReadonlyMap<string, string | null>,
  firstYear: ReadonlyMap<string, number>,
): string[] {
  const present = new Set(keys);
  const children = new Map<string | null, string[]>();
  for (const key of keys) {
    const parent = parentOf.get(key) ?? null;
    const anchor = parent !== null && present.has(parent) && parent !== key ? parent : null;
    const list = children.get(anchor) ?? [];
    list.push(key);
    children.set(anchor, list);
  }
  const byYear = (a: string, b: string) =>
    (firstYear.get(a) ?? 0) - (firstYear.get(b) ?? 0) || a.localeCompare(b);

  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    // Children split around their parent: the first above, the next below,
    // so a fork opens both ways instead of piling up on one bank.
    const kids = [...(children.get(key) ?? [])].sort(byYear);
    const above = kids.filter((_, index) => index % 2 === 0).reverse();
    const below = kids.filter((_, index) => index % 2 === 1);
    for (const kid of above) visit(kid);
    order.push(key);
    for (const kid of below) visit(kid);
  };
  for (const root of [...(children.get(null) ?? [])].sort(byYear)) visit(root);
  // Anything left by a cycle in the parent map still gets drawn.
  for (const key of [...keys].sort(byYear)) visit(key);
  return order;
}

export function layoutRiver(input: RiverInput): RiverLayout {
  const lives = input.rows.filter(
    (row): row is RiverRowInput & { earliestYear: number; latestYear: number } =>
      row.earliestYear !== null && row.latestYear !== null && row.latestYear >= row.earliestYear,
  );
  if (lives.length === 0) return { streams: [], fromYear: 0, toYear: 0, maxWidth: 0 };

  const fromYear = Math.min(...lives.map((row) => row.earliestYear));
  const toYear = Math.max(...lives.map((row) => row.latestYear));
  const maxSamples = input.maxSamples ?? 240;
  const step = Math.max(input.stepYears ?? 1, Math.ceil((toYear - fromYear + 1) / maxSamples));
  const years: number[] = [];
  for (let year = fromYear; year <= toYear + step; year += step) years.push(year);

  const byBranch = new Map<string, typeof lives>();
  for (const row of lives) {
    const list = byBranch.get(row.branchKey) ?? [];
    list.push(row);
    byBranch.set(row.branchKey, list);
  }
  const firstYear = new Map(
    [...byBranch].map(([key, rows]) => [key, Math.min(...rows.map((row) => row.earliestYear))]),
  );
  const order = branchOrder([...byBranch.keys()], input.parentOf, firstYear);

  // Alive per branch per sample, softened over three samples so a single
  // birth does not read as a cliff. A branch is zero outside its own years,
  // so the softening never widens a stream before its first life.
  const counts = new Map<string, number[]>();
  for (const key of order) {
    const rows = byBranch.get(key) ?? [];
    const raw = years.map(
      (year) => rows.filter((row) => row.earliestYear <= year && row.latestYear >= year).length,
    );
    const soft = raw.map((value, index) => {
      if (value === 0) return 0;
      const before = raw[index - 1] ?? value;
      const after = raw[index + 1] ?? value;
      return (before + 2 * value + after) / 4;
    });
    counts.set(key, soft);
  }

  const totals = years.map((_, index) =>
    order.reduce((sum, key) => sum + (counts.get(key)?.[index] ?? 0), 0),
  );
  const maxWidth = Math.max(...totals, 1);

  const offsets = totals.map((total) => -total / 2);
  const streams: RiverStream[] = order.map((key) => {
    const values = counts.get(key) ?? [];
    const samples = years.map((year, index) => {
      const y0 = offsets[index] ?? 0;
      const y1 = y0 + (values[index] ?? 0);
      offsets[index] = y1;
      return { year, y0, y1 };
    });
    let widest = 0;
    values.forEach((value, index) => {
      if (value > (values[widest] ?? 0)) widest = index;
    });
    const rows = byBranch.get(key) ?? [];
    return {
      branchKey: key,
      people: rows.length,
      firstYear: firstYear.get(key) ?? fromYear,
      lastYear: Math.max(...rows.map((row) => row.latestYear)),
      widestYear: years[widest] ?? fromYear,
      samples,
    };
  });

  return { streams, fromYear, toYear, maxWidth };
}

/**
 * A smooth closed outline through a stream's edges, as an SVG path: the top
 * bank left to right, the bottom bank back. Catmull–Rom through the samples,
 * as cubic Béziers, so the banks curve like water rather than step like a
 * histogram.
 */
export function streamPath(
  samples: readonly RiverSample[],
  x: (year: number) => number,
  y: (people: number) => number,
): string {
  if (samples.length === 0) return '';
  const top = samples.map((sample) => [x(sample.year), y(sample.y1)] as const);
  const bottom = [...samples].reverse().map((sample) => [x(sample.year), y(sample.y0)] as const);
  return `${smooth(top, true)} L${round(bottom[0]?.[0] ?? 0)} ${round(bottom[0]?.[1] ?? 0)} ${smooth(bottom, false)} Z`;
}

const round = (value: number) => Math.round(value * 10) / 10;

function smooth(points: readonly (readonly [number, number])[], move: boolean): string {
  const first = points[0];
  if (!first) return '';
  let path = move ? `M${round(first[0])} ${round(first[1])}` : '';
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return path;
}

/** The stream's course: a smooth open line down its middle, for the current. */
export function coursePath(
  samples: readonly RiverSample[],
  x: (year: number) => number,
  y: (people: number) => number,
): string {
  return smooth(
    samples.map((sample) => [x(sample.year), y((sample.y0 + sample.y1) / 2)] as const),
    true,
  );
}
