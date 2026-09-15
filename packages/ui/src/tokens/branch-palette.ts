/**
 * Branch colours.
 *
 * Family branches need identity colours that stay distinguishable at any
 * count, survive being drawn one pixel wide on a near-black timeline, and do
 * not shout over the interface.
 *
 * Three constraints shape the generator:
 *
 *  1. Fixed lightness and chroma. Varying only hue means no branch looks more
 *     important than another — a claim the colour would otherwise make on its
 *     own, and a false one.
 *  2. Golden-angle hue stepping. For any n, consecutive branches land far
 *     apart on the hue circle, so a family with six branches and one with
 *     sixty are both legible. Evenly dividing 360/n instead would make small
 *     palettes fine and large ones a gradient.
 *  3. Reserved hue bands. The brass of the interface accent and the red of
 *     danger are load-bearing semantics. A branch tinted like an error state
 *     is a bug in information design.
 */

export interface BranchColor {
  /** Full-strength line and marker colour. */
  readonly base: string;
  /** Dimmed, for unfocused branches when one is selected. */
  readonly muted: string;
  /** Background wash, for branch bands behind the timeline. */
  readonly wash: string;
  /** Text that remains readable on `base`. */
  readonly contrast: string;
  /** Hue in degrees, exposed for sorting and for the engine's shaders. */
  readonly hue: number;
}

const GOLDEN_ANGLE = 137.507_764_05;

/** Hue windows the interface reserves for meaning rather than identity. */
const RESERVED_BANDS: ReadonlyArray<readonly [number, number]> = [
  [58, 94], // brass: primary accent and warnings
  [12, 38], // red: danger and destructive actions
];

function isReserved(hue: number): boolean {
  const h = ((hue % 360) + 360) % 360;
  return RESERVED_BANDS.some(([from, to]) => h >= from && h <= to);
}

/** Push a hue out of a reserved band, to whichever edge is nearer. */
function avoidReserved(hue: number): number {
  let h = ((hue % 360) + 360) % 360;
  for (const [from, to] of RESERVED_BANDS) {
    if (h >= from && h <= to) {
      h = h - from < to - h ? from - 1 : to + 1;
    }
  }
  return ((h % 360) + 360) % 360;
}

export interface BranchPaletteOptions {
  /** Lightness, 0-1. Tuned for the dark flagship surface. */
  readonly lightness?: number;
  readonly chroma?: number;
  /** Rotates the whole palette, so two trees do not open identically. */
  readonly seedHue?: number;
}

const DEFAULTS = {
  lightness: 0.74,
  chroma: 0.115,
  seedHue: 196,
} as const;

/**
 * Colour for branch `index`.
 *
 * Deterministic: the same index always yields the same colour, so a branch
 * keeps its identity across reloads, across the timeline and the map, and in
 * a screenshot taken last month.
 */
export function branchColor(index: number, options: BranchPaletteOptions = {}): BranchColor {
  const lightness = options.lightness ?? DEFAULTS.lightness;
  const chroma = options.chroma ?? DEFAULTS.chroma;
  const seedHue = options.seedHue ?? DEFAULTS.seedHue;

  const hue = avoidReserved(seedHue + index * GOLDEN_ANGLE);

  return {
    hue,
    base: `oklch(${lightness} ${chroma} ${hue.toFixed(1)})`,
    muted: `oklch(${(lightness * 0.62).toFixed(3)} ${(chroma * 0.45).toFixed(3)} ${hue.toFixed(1)})`,
    wash: `oklch(${lightness} ${chroma} ${hue.toFixed(1)} / 0.09)`,
    // At L 0.74 a dark foreground always wins; the palette never crosses the
    // lightness where that stops being true.
    contrast: `oklch(0.17 0.02 ${hue.toFixed(1)})`,
  };
}

export function branchPalette(count: number, options: BranchPaletteOptions = {}): BranchColor[] {
  return Array.from({ length: count }, (_, i) => branchColor(i, options));
}

/**
 * Stable colour for a branch identified by a string (a root person's id).
 *
 * Hashing the id rather than using positional order means a branch keeps its
 * colour when another branch is added or removed — a reordering would
 * otherwise repaint the whole tree and destroy the user's mental map.
 */
export function branchColorForKey(key: string, options: BranchPaletteOptions = {}): BranchColor {
  let hash = 2_166_136_261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return branchColor(Math.abs(hash) % 997, options);
}

export { isReserved as isReservedHue };
