import {
  barGeometry,
  cullLabels,
  decideLod,
  jdnToX,
  temporalTicks,
  type DetailLevel,
  type TemporalViewport,
} from '@chronolignee/engine';
import { branchColorForKey, EDGE_STYLES, type EdgeCertainty } from '@chronolignee/ui';
import type { TimelineSnapshot } from '@/server/timeline';
import { LANE_HEIGHT, TRACK_HEIGHT, laneMarks, laneTracks } from './history-lane';

/**
 * The timeline renderer.
 *
 * A pure function of (snapshot, viewport, interaction state) onto a 2D
 * context. No React, no event handlers, no state of its own — which is what
 * makes it possible to reason about a frame in isolation, and what will make
 * it replaceable by the WebGPU path without touching anything else.
 *
 * Drawing order is back to front and deliberate: historical context sits
 * behind the family, never competing with it; relationship links sit behind
 * the bars they connect; labels sit on top of everything because a name that
 * is half-covered is worse than no name.
 */

export interface TimelineTheme {
  readonly surface: string;
  readonly gridLine: string;
  readonly gridLineMajor: string;
  readonly textMuted: string;
  readonly textPrimary: string;
  readonly accent: string;
  readonly linkColor: string;
  readonly bandColor: string;
  readonly fontSans: string;
  readonly fontSerif: string;
  readonly sexFemale: string;
  readonly sexMale: string;
  readonly sexOther: string;
  readonly sexUnknown: string;
  /** History, by category: WAR, POLITICAL, EPIDEMIC… */
  readonly history: Readonly<Record<string, string>>;
}

/**
 * What a bar's colour says.
 *
 * SEX is the reading genealogists know from paper charts — pink for women,
 * blue for men — and the default. BRANCH colours each line of descent, which
 * is what to use to follow one family through a crowded century.
 */
export type TimelineColorMode = 'SEX' | 'BRANCH';

/**
 * Animation state, owned by the canvas component and read here.
 *
 * Every value is a plain number in [0, 1] so a frame stays a pure function of
 * its inputs: the renderer never reads a clock, and a test can draw any
 * instant of any animation.
 */
export interface TimelineAnimation {
  /** Lives drawing themselves on first display; 1 when done. */
  readonly entrance: number;
  /** The selected person's birth links drawing from parent to child. */
  readonly focus: number;
  /** Phase of the ring that pulses at the selected birth; 0 when still. */
  readonly pulse: number;
}

export const STILL: TimelineAnimation = { entrance: 1, focus: 1, pulse: 0 };

export interface TimelineInteraction {
  readonly hoveredRow: number | null;
  readonly selectedPersonId: string | null;
  /** Rows connected to the selection, dimmed differently from the rest. */
  readonly relatedRows: ReadonlySet<number>;
  /**
   * The temporal cursor, when time travel is engaged.
   *
   * `states` is one byte per row from whoWasAlive(). Passing the codes rather
   * than recomputing here keeps the answer in one place and keeps the render
   * loop free of genealogical reasoning.
   */
  readonly cursor: { readonly jdn: number; readonly states: Uint8Array } | null;
  /** The historical event under the pointer in the history lane. */
  readonly hoveredBandId?: string | null;
  /** The historical event the reader chose: its period lights up over the lives. */
  readonly selectedBandId?: string | null;
}

export interface RenderOptions {
  readonly snapshot: TimelineSnapshot;
  readonly viewport: TemporalViewport;
  readonly heightPx: number;
  readonly scrollTopPx: number;
  readonly rowHeightPx: number;
  readonly theme: TimelineTheme;
  readonly interaction: TimelineInteraction;
  readonly colorMode?: TimelineColorMode;
  readonly animation?: TimelineAnimation;
}

type TimelineRowData = RenderOptions['snapshot']['rows'][number];

/** The colour of one life, under the chosen reading. */
export function rowColour(
  row: Pick<TimelineRowData, 'sex' | 'branchKey'>,
  theme: TimelineTheme,
  mode: TimelineColorMode,
): string {
  if (mode === 'BRANCH') return branchColorForKey(row.branchKey).base;
  switch (row.sex) {
    case 'FEMALE':
      return theme.sexFemale;
    case 'MALE':
      return theme.sexMale;
    case 'OTHER':
      return theme.sexOther;
    default:
      return theme.sexUnknown;
  }
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
const easeOutCubic = (value: number): number => 1 - (1 - clamp01(value)) ** 3;

/**
 * How far along its entrance one visible row is.
 *
 * Rows arrive top to bottom, staggered across the first 40 % of the
 * animation, each taking the remaining 60 % to grow — a cascade that reads as
 * generations following each other rather than a block appearing.
 */
function entranceOf(animation: TimelineAnimation, index: number, first: number, last: number) {
  if (animation.entrance >= 1) return 1;
  const span = Math.max(last - first, 1);
  const delay = ((index - first) / span) * 0.4;
  return easeOutCubic((animation.entrance - delay) / 0.6);
}

/**
 * How present each state looks when the temporal cursor is engaged.
 *
 * Unborn all but disappears and the deceased recede rather than vanish: the
 * difference carries the direction of time, which is the whole point of
 * moving a cursor across a century. Collapsing both into "absent" would make
 * the past and the future look identical.
 */
const STATE_ALPHA: Readonly<Record<number, number>> = {
  0: 0.06, // UNBORN
  1: 1, // ALIVE_CERTAIN
  2: 0.5, // ALIVE_POSSIBLE
  3: 0.22, // DECEASED
  4: 0.14, // UNDATED
  5: 0.14, // HIDDEN
};

/** Opacity for one row under the temporal cursor, 1 when time travel is off. */
function cursorAlphaFor(interaction: TimelineInteraction, row: number): number {
  if (!interaction.cursor) return 1;
  return STATE_ALPHA[interaction.cursor.states[row] ?? 4] ?? 1;
}

const AXIS_HEIGHT = 26;
/** The axis and the history lane under it; the rows start below both. */
const HEADER_HEIGHT = AXIS_HEIGHT + LANE_HEIGHT;
const BAR_INSET = 4;
const LABEL_GUTTER = 10;

export interface RenderResult {
  /** Rows actually drawn, so the caller can report what is on screen. */
  readonly visibleRows: number;
  readonly detailLevel: DetailLevel;
}

export function renderTimeline(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
): RenderResult {
  const { snapshot, viewport, heightPx, scrollTopPx, rowHeightPx, theme } = options;
  const width = viewport.widthPx;

  ctx.clearRect(0, 0, width, heightPx);
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, width, heightPx);

  // Only the rows that intersect the viewport are considered at all. Without
  // this, a 20 000-person tree costs 20 000 iterations per frame to draw the
  // thirty rows anyone can see.
  const firstRow = Math.max(0, Math.floor(scrollTopPx / rowHeightPx) - 1);
  const lastRow = Math.min(
    snapshot.rows.length - 1,
    Math.ceil((scrollTopPx + heightPx) / rowHeightPx) + 1,
  );

  const lod = decideLod({
    viewport,
    rowHeightPx,
    personCount: Math.max(lastRow - firstRow + 1, 0),
  });

  const rowY = (row: number): number =>
    HEADER_HEIGHT + row * rowHeightPx - scrollTopPx + rowHeightPx / 2;

  drawBands(ctx, options, lod.showHistoricalBands);
  drawGrid(ctx, options);
  if (lod.showRelationshipLinks) drawLinks(ctx, options, rowY, firstRow, lastRow, 'LINES');
  drawBars(ctx, options, rowY, firstRow, lastRow, lod.minBarWidthPx);
  if (lod.showEventMarkers) drawEvents(ctx, options, rowY, firstRow, lastRow);
  // Nodes go over the bars: the ring at a birth sits on the child's bar,
  // where the life it marks begins.
  if (lod.showRelationshipLinks) drawLinks(ctx, options, rowY, firstRow, lastRow, 'NODES');
  if (lod.showPersonLabels) drawLabels(ctx, options, rowY, firstRow, lastRow);
  drawTodayLine(ctx, options);
  drawTemporalCursor(ctx, options);
  drawAxis(ctx, options);
  drawHistoryLane(ctx, options);

  return { visibleRows: Math.max(lastRow - firstRow + 1, 0), detailLevel: lod.level };
}

/**
 * Historical context, behind everything.
 *
 * Deliberately very low contrast. This layer answers "what was happening
 * while they lived", and the moment it competes with the family data it stops
 * being context and becomes noise.
 */
function drawBands(ctx: CanvasRenderingContext2D, options: RenderOptions, enabled: boolean): void {
  const { snapshot, viewport, heightPx, theme, interaction } = options;
  const selected = interaction.selectedBandId ?? null;

  for (const band of snapshot.bands) {
    const isSelected = band.id === selected;
    // Behind the lives, only the events that shaped every family — and the
    // one the reader chose. Sixty faint bands at once would be a fog.
    if (!isSelected && (!enabled || band.significance < 4 || selected !== null)) continue;
    const x1 = jdnToX(viewport, band.startJdn);
    const x2 = jdnToX(viewport, band.endJdn + 1);
    if (x2 < 0 || x1 > viewport.widthPx) continue;
    const colour = theme.history[band.category] ?? theme.bandColor;
    const width = Math.max(x2 - x1, 2);

    ctx.fillStyle = colour;
    ctx.globalAlpha = isSelected ? 0.16 : 0.035 + (band.significance - 3) * 0.012;
    ctx.fillRect(x1, HEADER_HEIGHT, width, heightPx - HEADER_HEIGHT);

    if (isSelected) {
      // Its edges, so the period reads exactly, and its name over the lives.
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const x of [x1, x1 + width]) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, HEADER_HEIGHT);
        ctx.lineTo(Math.round(x) + 0.5, heightPx);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = `600 12px ${theme.fontSans}`;
      ctx.textBaseline = 'top';
      const label = band.title;
      const textX = Math.min(
        Math.max(x1 + 6, 6),
        viewport.widthPx - ctx.measureText(label).width - 6,
      );
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeText(label, textX, HEADER_HEIGHT + 6);
      ctx.fillStyle = colour;
      ctx.fillText(label, textX, HEADER_HEIGHT + 6);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * The history lane, under the axis: every event of the tree's context as a
 * coloured mark on its track — a bar for a period, a diamond for a day. The
 * one under the pointer brightens; the one chosen is outlined.
 */
function drawHistoryLane(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { snapshot, viewport, theme, interaction } = options;
  ctx.save();
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, AXIS_HEIGHT, viewport.widthPx, LANE_HEIGHT);
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT - 0.5);
  ctx.lineTo(viewport.widthPx, HEADER_HEIGHT - 0.5);
  ctx.stroke();

  const marks = laneMarks(snapshot.bands, laneTracks(snapshot.bands), viewport, AXIS_HEIGHT);
  const appear = (options.animation ?? STILL).entrance;
  for (const [index, mark] of marks.entries()) {
    const { band } = mark;
    const colour = theme.history[band.category] ?? theme.bandColor;
    const hovered = interaction.hoveredBandId === band.id;
    const selected = interaction.selectedBandId === band.id;
    // The lane fills from left to right with the lives' entrance.
    const shown = Math.min(
      Math.max(appear * 1.6 - (index / Math.max(marks.length, 1)) * 0.6, 0),
      1,
    );
    if (shown <= 0) continue;
    const dimmed = interaction.selectedBandId && !selected;
    ctx.globalAlpha =
      (dimmed ? 0.35 : hovered || selected ? 1 : 0.55 + band.significance * 0.08) * shown;
    ctx.fillStyle = colour;
    if (mark.point) {
      const cx = (mark.x1 + mark.x2) / 2;
      const cy = mark.y + TRACK_HEIGHT / 2;
      const r = hovered || selected ? 5 : 3.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
    } else {
      const width = Math.max(mark.x2 - mark.x1, 2);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(mark.x1, mark.y, width, TRACK_HEIGHT, TRACK_HEIGHT / 2);
      } else {
        ctx.rect(mark.x1, mark.y, width, TRACK_HEIGHT);
      }
      ctx.fill();
    }
    if (selected || hovered) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.textPrimary;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.min(mark.x1, mark.x2 - 4) - 1.5,
        mark.y - 1.5,
        Math.max(mark.x2 - mark.x1, 4) + 3,
        TRACK_HEIGHT + 3,
      );
    }
  }
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { viewport, heightPx, theme } = options;
  const ticks = temporalTicks(viewport);

  for (const tick of ticks) {
    ctx.strokeStyle = tick.major ? theme.gridLineMajor : theme.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Half-pixel offset so a one-pixel line lands on a pixel instead of
    // straddling two and rendering as a two-pixel blur.
    ctx.moveTo(Math.round(tick.x) + 0.5, AXIS_HEIGHT);
    ctx.lineTo(Math.round(tick.x) + 0.5, heightPx);
    ctx.stroke();
  }
}

/**
 * Relationships, in two passes.
 *
 * A birth is drawn where it happened: a vertical line at the child's birth,
 * from a dot on the parent's life to a ring where the child's life begins.
 * In the pink/blue reading the line carries the parent's colour into the
 * child's, so "born of his mother" and "born of his father" are told apart
 * without reading a label. A union is a double line, in the accent colour,
 * at the marriage.
 *
 * The selected person's links draw themselves from parent to child, and a
 * ring pulses at the birth — the eye is taken to the moment, not left to
 * search for it among three centuries of lines.
 */
function drawLinks(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  rowY: (row: number) => number,
  firstRow: number,
  lastRow: number,
  pass: 'LINES' | 'NODES',
): void {
  const { snapshot, viewport, theme, interaction } = options;
  const mode = options.colorMode ?? 'SEX';
  const animation = options.animation ?? STILL;
  const selectedRow =
    interaction.selectedPersonId === null
      ? null
      : (snapshot.rows.find((row) => row.personId === interaction.selectedPersonId)?.row ?? null);
  const appear = easeOutCubic(animation.entrance * 1.4 - 0.4);
  if (appear <= 0) return;

  for (const link of snapshot.links) {
    if (link.jdn === null) continue;
    // A link is drawn when either end is on screen, so a line into an
    // off-screen parent still shows the relationship leaving the viewport.
    if (link.fromRow < firstRow && link.toRow < firstRow) continue;
    if (link.fromRow > lastRow && link.toRow > lastRow) continue;

    const x = jdnToX(viewport, link.jdn);
    if (x < -50 || x > viewport.widthPx + 50) continue;

    const focused =
      selectedRow !== null && (link.fromRow === selectedRow || link.toRow === selectedRow);
    const baseAlpha = focused ? 0.95 : selectedRow !== null ? 0.1 : 0.55;
    const timeAlpha = Math.min(
      cursorAlphaFor(interaction, link.fromRow),
      cursorAlphaFor(interaction, link.toRow),
    );
    const alpha = baseAlpha * timeAlpha * appear;
    const y1 = rowY(link.fromRow);
    const y2 = rowY(link.toRow);
    const progress = focused ? easeOutCubic(animation.focus) : 1;
    const yEnd = y1 + (y2 - y1) * progress;

    if (link.kind === 'PARTNER') {
      if (pass === 'LINES') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = focused ? 1.25 : 1;
        for (const offset of [-1.5, 1.5]) {
          ctx.beginPath();
          ctx.moveTo(x + offset, y1);
          ctx.lineTo(x + offset, yEnd);
          ctx.stroke();
        }
        ctx.restore();
      } else if (progress >= 1) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = theme.accent;
        ctx.fillStyle = theme.surface;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(x, (y1 + y2) / 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      continue;
    }

    const parent = snapshot.rows[link.fromRow];
    const child = snapshot.rows[link.toRow];
    const parentColour = parent ? rowColour(parent, theme, mode) : theme.linkColor;
    const childColour = child ? rowColour(child, theme, mode) : theme.linkColor;

    if (pass === 'LINES') {
      ctx.save();
      ctx.globalAlpha = alpha;
      if (mode === 'SEX' && Math.abs(yEnd - y1) > 1) {
        const gradient = ctx.createLinearGradient(0, y1, 0, yEnd);
        gradient.addColorStop(0, parentColour);
        gradient.addColorStop(1, progress >= 1 ? childColour : parentColour);
        ctx.strokeStyle = gradient;
      } else {
        ctx.strokeStyle = theme.linkColor;
      }
      ctx.lineWidth = focused ? 2 : 1.25;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, yEnd);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    // --- Nodes: the parent's dot, the child's birth ring, the pulse ------
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = parentColour;
    ctx.beginPath();
    ctx.arc(x, y1, focused ? 3 : 2.25, 0, Math.PI * 2);
    ctx.fill();

    if (progress >= 1 && link.toRow >= firstRow && link.toRow <= lastRow) {
      ctx.fillStyle = theme.surface;
      ctx.strokeStyle = childColour;
      ctx.lineWidth = focused ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(x, y2, focused ? 4 : 3.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (focused && link.toRow === selectedRow && animation.pulse > 0) {
        ctx.globalAlpha = alpha * (1 - animation.pulse) * 0.7;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y2, 4 + animation.pulse * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  rowY: (row: number) => number,
  firstRow: number,
  lastRow: number,
  minBarWidthPx: number,
): void {
  const { snapshot, viewport, rowHeightPx, interaction } = options;
  const barHeight = Math.max(rowHeightPx - BAR_INSET * 2, 2);

  for (let i = firstRow; i <= lastRow; i += 1) {
    const row = snapshot.rows[i];
    if (!row) continue;

    if (row.redacted) {
      drawRedactedRow(ctx, options, rowY(row.row), barHeight);
      continue;
    }

    const full = barGeometry(viewport, { earliest: row.earliestJdn, latest: row.latestJdn });
    if (!full.visible || full.width < minBarWidthPx) continue;

    // On first display a life grows from its birth to its end.
    const grown = entranceOf(options.animation ?? STILL, i, firstRow, lastRow);
    if (grown <= 0) continue;
    const bar = { ...full, width: Math.max(full.width * grown, 1) };

    const y = rowY(row.row) - barHeight / 2;
    const colour = rowColour(row, options.theme, options.colorMode ?? 'SEX');
    const selected = interaction.selectedPersonId === row.personId;

    const dimmed = interaction.selectedPersonId !== null && !interaction.relatedRows.has(row.row);
    ctx.globalAlpha = (dimmed ? 0.22 : 1) * cursorAlphaFor(interaction, i) * Math.min(grown * 2, 1);

    // An open edge fades instead of ending. A hard cap there would assert a
    // boundary nobody recorded.
    const fill = needsFade(row.startCertainty, row.endCertainty)
      ? fadeGradient(ctx, bar.x, bar.width, colour, row.startCertainty, row.endCertainty)
      : colour;

    ctx.fillStyle = fill;
    if (selected) {
      // The selected life glows in its own colour: found at a glance, and
      // still the same colour as everything that says who they are.
      ctx.save();
      ctx.shadowColor = colour;
      ctx.shadowBlur = 14;
      roundedBar(ctx, bar.x, y - 1, bar.width, barHeight + 2);
      ctx.fill();
      ctx.restore();
    } else {
      roundedBar(ctx, bar.x, y, bar.width, barHeight);
      ctx.fill();
    }

    // An approximate date is dashed as well as faded, so the distinction
    // survives greyscale and colour-blindness.
    if (row.endCertainty === 'APPROXIMATE' || row.startCertainty === 'APPROXIMATE') {
      drawApproximateHatch(ctx, bar.x, y, bar.width, barHeight, row);
    }

    if (interaction.hoveredRow === row.row) {
      ctx.strokeStyle = options.theme.textPrimary;
      ctx.globalAlpha = dimmed ? 0.3 : 0.8;
      ctx.lineWidth = 1;
      ctx.strokeRect(bar.x - 0.5, y - 0.5, bar.width + 1, barHeight + 1);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * A living person this viewer may not see.
 *
 * Drawn as a short hatched stub at the right-hand edge rather than omitted:
 * a blank row reads as a rendering bug, while an explicit marker says
 * "someone is here and their details are protected", which is true and is
 * itself information about the shape of the family.
 */
function drawRedactedRow(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  y: number,
  barHeight: number,
): void {
  const { viewport, theme } = options;
  const width = 54;
  const x = viewport.widthPx - width - 16;

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = theme.textMuted;
  for (let i = 0; i < width; i += 6) {
    ctx.fillRect(x + i, y - barHeight / 2, 3, barHeight);
  }
  ctx.restore();
}

/** A bar with softly rounded ends, never rounder than half its height. */
function roundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const radius = Math.min(height / 2, width / 2, 4);
  ctx.beginPath();
  if (radius < 1 || typeof ctx.roundRect !== 'function') {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.roundRect(x, y, width, height, radius);
}

function needsFade(start: EdgeCertainty, end: EdgeCertainty): boolean {
  return start === 'UNKNOWN' || end === 'UNKNOWN' || end === 'INFERRED' || start === 'INFERRED';
}

function fadeGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  colour: string,
  start: EdgeCertainty,
  end: EdgeCertainty,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
  const startAlpha = EDGE_STYLES[start].opacity;
  const endAlpha = EDGE_STYLES[end].opacity;

  gradient.addColorStop(0, withAlpha(colour, start === 'UNKNOWN' ? 0 : startAlpha));
  gradient.addColorStop(Math.min(EDGE_STYLES[start].featherFraction, 0.45), withAlpha(colour, 1));
  gradient.addColorStop(Math.max(1 - EDGE_STYLES[end].featherFraction, 0.55), withAlpha(colour, 1));
  gradient.addColorStop(1, withAlpha(colour, end === 'UNKNOWN' ? 0 : endAlpha * 0.25));
  return gradient;
}

/** OKLCH strings carry their own alpha slot, so this stays a string edit. */
function withAlpha(colour: string, alpha: number): string {
  if (alpha >= 1) return colour;
  return colour.replace(/\)$/, ` / ${alpha.toFixed(3)})`);
}

function drawApproximateHatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  row: { startCertainty: EdgeCertainty; endCertainty: EdgeCertainty },
): void {
  const feather = Math.min(width * 0.18, 26);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';

  const notch = 3;
  if (row.startCertainty === 'APPROXIMATE') {
    for (let i = 0; i < feather; i += notch * 2) {
      ctx.fillRect(x + i, y, notch, height);
    }
  }
  if (row.endCertainty === 'APPROXIMATE') {
    for (let i = 0; i < feather; i += notch * 2) {
      ctx.fillRect(x + width - i - notch, y, notch, height);
    }
  }
  ctx.restore();
}

function drawEvents(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  rowY: (row: number) => number,
  firstRow: number,
  lastRow: number,
): void {
  const { snapshot, viewport, theme, interaction } = options;

  for (const event of snapshot.events) {
    if (event.row < firstRow || event.row > lastRow) continue;
    const x = jdnToX(viewport, event.jdn);
    if (x < -4 || x > viewport.widthPx + 4) continue;

    // An event later than the cursor has not happened yet, so it is not drawn.
    // Showing it would put the future on a timeline claiming to be a
    // particular moment in the past.
    if (interaction.cursor && event.jdn > interaction.cursor.jdn) continue;

    const dimmed = interaction.selectedPersonId !== null && !interaction.relatedRows.has(event.row);
    ctx.globalAlpha = (dimmed ? 0.2 : 0.9) * cursorAlphaFor(interaction, event.row);
    ctx.fillStyle = theme.textPrimary;

    const y = rowY(event.row);
    // A small diamond rather than a dot: at one or two pixels a diamond keeps
    // a recognisable silhouette where a circle turns into a smudge.
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x + 2.5, y);
    ctx.lineTo(x, y + 3);
    ctx.lineTo(x - 2.5, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  rowY: (row: number) => number,
  firstRow: number,
  lastRow: number,
): void {
  const { snapshot, viewport, theme, interaction, rowHeightPx } = options;

  ctx.font = `${Math.min(rowHeightPx - 8, 12)}px ${theme.fontSerif}`;
  ctx.textBaseline = 'middle';

  for (let i = firstRow; i <= lastRow; i += 1) {
    const row = snapshot.rows[i];
    if (!row) continue;

    if (row.redacted) continue;

    const bar = barGeometry(viewport, { earliest: row.earliestJdn, latest: row.latestJdn });
    if (!bar.visible) continue;

    const arrived = entranceOf(options.animation ?? STILL, i, firstRow, lastRow);
    if (arrived <= 0) continue;
    const dimmed = interaction.selectedPersonId !== null && !interaction.relatedRows.has(row.row);
    ctx.globalAlpha = (dimmed ? 0.3 : 1) * cursorAlphaFor(interaction, i) * arrived;
    ctx.fillStyle =
      interaction.hoveredRow === row.row || interaction.selectedPersonId === row.personId
        ? theme.textPrimary
        : theme.textMuted;

    // Label to the left of the bar, or inside it when the bar runs off the
    // left edge — so a name never floats in space away from its life.
    const textWidth = ctx.measureText(row.displayName).width;
    const preferredX = bar.x - LABEL_GUTTER - textWidth;
    const x = preferredX < 2 ? Math.max(bar.x + LABEL_GUTTER / 2, 4) : preferredX;
    const y = rowY(row.row);

    // A halo in the background colour, drawn under the glyphs.
    //
    // Rows are close enough that a long name reaches over the bar on the row
    // above. Without the halo the name and the bar interleave into something
    // neither legible nor identifiable — and a half-covered name is worse than
    // no name at all.
    ctx.save();
    ctx.strokeStyle = theme.surface;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = (dimmed ? 0.3 : 1) * 0.85 * arrived;
    ctx.strokeText(row.displayName, x, y);
    ctx.restore();

    ctx.fillText(row.displayName, x, y);
  }
  ctx.globalAlpha = 1;
}

function drawTodayLine(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { snapshot, viewport, heightPx, theme } = options;
  const x = jdnToX(viewport, snapshot.todayJdn);
  if (x < 0 || x > viewport.widthPx) return;

  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, AXIS_HEIGHT);
  ctx.lineTo(Math.round(x) + 0.5, heightPx);
  ctx.stroke();
  ctx.restore();
}

/**
 * The temporal cursor.
 *
 * Drawn in the accent colour and solid, where "today" is dotted: the cursor is
 * where the user has put time, and it has to be findable instantly among three
 * centuries of gridlines.
 */
function drawTemporalCursor(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { viewport, heightPx, theme, interaction } = options;
  if (!interaction.cursor) return;

  const x = jdnToX(viewport, interaction.cursor.jdn);
  if (x < 0 || x > viewport.widthPx) return;

  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, AXIS_HEIGHT);
  ctx.lineTo(Math.round(x) + 0.5, heightPx);
  ctx.stroke();

  // A small handle at the top, so the line reads as something grabbable
  // rather than as another gridline.
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.moveTo(x - 5, AXIS_HEIGHT);
  ctx.lineTo(x + 5, AXIS_HEIGHT);
  ctx.lineTo(x, AXIS_HEIGHT + 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAxis(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { viewport, theme } = options;

  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, viewport.widthPx, AXIS_HEIGHT);
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, AXIS_HEIGHT - 0.5);
  ctx.lineTo(viewport.widthPx, AXIS_HEIGHT - 0.5);
  ctx.stroke();

  ctx.font = `11px ${theme.fontSans}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.textMuted;

  const ticks = temporalTicks(viewport);
  const labelled = cullLabels(
    ticks,
    (tick) => tick.x,
    (tick) => ctx.measureText(labelFor(tick)).width,
    14,
  );

  for (const tick of labelled) {
    ctx.fillText(labelFor(tick), tick.x + 4, AXIS_HEIGHT / 2);
  }
}

const MONTH_ABBREVIATIONS = [
  'janv',
  'févr',
  'mars',
  'avr',
  'mai',
  'juin',
  'juil',
  'août',
  'sept',
  'oct',
  'nov',
  'déc',
];

function labelFor(tick: { unit: string; year: number; month: number; day: number }): string {
  if (tick.unit === 'DAY') return `${tick.day} ${MONTH_ABBREVIATIONS[tick.month - 1] ?? ''}`;
  if (tick.unit === 'MONTH') {
    return tick.month === 1
      ? String(tick.year)
      : (MONTH_ABBREVIATIONS[tick.month - 1] ?? String(tick.month));
  }
  return String(tick.year);
}

export { AXIS_HEIGHT, HEADER_HEIGHT };
