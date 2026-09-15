import {
  barGeometry,
  cullLabels,
  decideLod,
  jdnToX,
  temporalTicks,
  type TemporalViewport,
} from '@chronolignee/engine';
import { branchColorForKey, EDGE_STYLES, type EdgeCertainty } from '@chronolignee/ui';
import type { TimelineSnapshot } from '@/server/timeline';

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
}

export interface TimelineInteraction {
  readonly hoveredRow: number | null;
  readonly selectedPersonId: string | null;
  /** Rows connected to the selection, dimmed differently from the rest. */
  readonly relatedRows: ReadonlySet<number>;
}

export interface RenderOptions {
  readonly snapshot: TimelineSnapshot;
  readonly viewport: TemporalViewport;
  readonly heightPx: number;
  readonly scrollTopPx: number;
  readonly rowHeightPx: number;
  readonly theme: TimelineTheme;
  readonly interaction: TimelineInteraction;
}

const AXIS_HEIGHT = 26;
const BAR_INSET = 4;
const LABEL_GUTTER = 10;

export interface RenderResult {
  /** Rows actually drawn, so the caller can report what is on screen. */
  readonly visibleRows: number;
  readonly detailLevel: string;
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
    AXIS_HEIGHT + row * rowHeightPx - scrollTopPx + rowHeightPx / 2;

  drawBands(ctx, options, lod.showHistoricalBands);
  drawGrid(ctx, options);
  if (lod.showRelationshipLinks) drawLinks(ctx, options, rowY, firstRow, lastRow);
  drawBars(ctx, options, rowY, firstRow, lastRow, lod.minBarWidthPx);
  if (lod.showEventMarkers) drawEvents(ctx, options, rowY, firstRow, lastRow);
  if (lod.showPersonLabels) drawLabels(ctx, options, rowY, firstRow, lastRow);
  drawTodayLine(ctx, options);
  drawAxis(ctx, options);

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
  if (!enabled) return;
  const { snapshot, viewport, heightPx, theme } = options;

  for (const band of snapshot.bands) {
    const x1 = jdnToX(viewport, band.startJdn);
    const x2 = jdnToX(viewport, band.endJdn);
    if (x2 < 0 || x1 > viewport.widthPx) continue;

    ctx.fillStyle = theme.bandColor;
    ctx.globalAlpha = 0.05 + band.significance * 0.012;
    ctx.fillRect(x1, AXIS_HEIGHT, Math.max(x2 - x1, 1), heightPx - AXIS_HEIGHT);
    ctx.globalAlpha = 1;
  }
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

function drawLinks(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  rowY: (row: number) => number,
  firstRow: number,
  lastRow: number,
): void {
  const { snapshot, viewport, theme, interaction } = options;

  ctx.lineWidth = 1;
  for (const link of snapshot.links) {
    if (link.jdn === null) continue;
    // A link is drawn when either end is on screen, so a line into an
    // off-screen parent still shows the relationship leaving the viewport.
    if (link.fromRow < firstRow && link.toRow < firstRow) continue;
    if (link.fromRow > lastRow && link.toRow > lastRow) continue;

    const x = jdnToX(viewport, link.jdn);
    if (x < -50 || x > viewport.widthPx + 50) continue;

    const highlighted =
      interaction.relatedRows.has(link.fromRow) || interaction.relatedRows.has(link.toRow);

    ctx.strokeStyle = theme.linkColor;
    ctx.globalAlpha = highlighted ? 0.85 : interaction.selectedPersonId ? 0.15 : 0.4;

    const y1 = rowY(link.fromRow);
    const y2 = rowY(link.toRow);
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
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

    const bar = barGeometry(viewport, { earliest: row.earliestJdn, latest: row.latestJdn });
    if (!bar.visible || bar.width < minBarWidthPx) continue;

    const y = rowY(row.row) - barHeight / 2;
    const colour = branchColorForKey(row.branchKey);

    const dimmed = interaction.selectedPersonId !== null && !interaction.relatedRows.has(row.row);
    ctx.globalAlpha = dimmed ? 0.22 : 1;

    // An open edge fades instead of ending. A hard cap there would assert a
    // boundary nobody recorded.
    const fill = needsFade(row.startCertainty, row.endCertainty)
      ? fadeGradient(ctx, bar.x, bar.width, colour.base, row.startCertainty, row.endCertainty)
      : colour.base;

    ctx.fillStyle = fill;
    ctx.fillRect(bar.x, y, bar.width, barHeight);

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

    const dimmed = interaction.selectedPersonId !== null && !interaction.relatedRows.has(event.row);
    ctx.globalAlpha = dimmed ? 0.2 : 0.9;
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

    const dimmed = interaction.selectedPersonId !== null && !interaction.relatedRows.has(row.row);
    ctx.globalAlpha = dimmed ? 0.3 : 1;
    ctx.fillStyle = interaction.hoveredRow === row.row ? theme.textPrimary : theme.textMuted;

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
    ctx.globalAlpha = (dimmed ? 0.3 : 1) * 0.85;
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

export { AXIS_HEIGHT };
