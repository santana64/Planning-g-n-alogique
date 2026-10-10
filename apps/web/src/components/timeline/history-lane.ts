import { jdnToX, type TemporalViewport } from '@chronolignee/engine';
import type { TimelineBand } from '@/server/timeline';

/**
 * The history lane: a strip under the time axis where the world's events
 * sit, one coloured mark per event, so that "what was happening then" can be
 * read at the same glance as the lives below it.
 *
 * Pure and shared by the renderer (to draw) and the canvas component (to
 * know what the pointer is over), so the two can never disagree about where
 * an event is.
 */

export const LANE_HEIGHT = 26;
/** Overlapping events are spread over this many tracks. */
export const LANE_TRACKS = 3;
const TRACK_HEIGHT = 6;
const TRACK_GAP = 2;
const TOP_PADDING = 3;
/** Below this width on screen an event is drawn as a point marker. */
const POINT_WIDTH_PX = 5;

export interface LaneMark {
  readonly band: TimelineBand;
  readonly track: number;
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
  readonly point: boolean;
}

/**
 * Tracks assigned greedily by start, most significant first among equals:
 * the big events take the top track and stay readable when the lane is busy.
 * Assigned on the whole catalogue, not on what is on screen, so an event
 * does not jump tracks as the reader pans.
 */
export function laneTracks(bands: readonly TimelineBand[]): Map<string, number> {
  const sorted = [...bands].sort(
    (a, b) => a.startJdn - b.startJdn || b.significance - a.significance,
  );
  const trackEnds: number[] = Array.from({ length: LANE_TRACKS }, () => Number.NEGATIVE_INFINITY);
  const tracks = new Map<string, number>();
  for (const band of sorted) {
    let track = trackEnds.findIndex((end) => end < band.startJdn);
    // Every track busy: the least important events share the last one.
    if (track === -1) track = LANE_TRACKS - 1;
    trackEnds[track] = Math.max(trackEnds[track] ?? 0, band.endJdn);
    tracks.set(band.id, track);
  }
  return tracks;
}

export function laneMarks(
  bands: readonly TimelineBand[],
  tracks: ReadonlyMap<string, number>,
  viewport: TemporalViewport,
  top: number,
): LaneMark[] {
  const marks: LaneMark[] = [];
  for (const band of bands) {
    const x1 = jdnToX(viewport, band.startJdn);
    const x2 = jdnToX(viewport, band.endJdn + 1);
    if (x2 < -10 || x1 > viewport.widthPx + 10) continue;
    const track = tracks.get(band.id) ?? 0;
    marks.push({
      band,
      track,
      x1,
      x2,
      y: top + TOP_PADDING + track * (TRACK_HEIGHT + TRACK_GAP),
      point: x2 - x1 < POINT_WIDTH_PX,
    });
  }
  return marks;
}

export { TRACK_HEIGHT };

/** The event under a point of the lane, preferring the shortest one. */
export function markAt(marks: readonly LaneMark[], x: number, y: number): LaneMark | null {
  let best: LaneMark | null = null;
  for (const mark of marks) {
    const inY = y >= mark.y - 3 && y <= mark.y + TRACK_HEIGHT + 3;
    const inX = mark.point
      ? Math.abs(x - (mark.x1 + mark.x2) / 2) <= 6
      : x >= mark.x1 && x <= mark.x2;
    if (!inY || !inX) continue;
    if (!best || mark.x2 - mark.x1 < best.x2 - best.x1) best = mark;
  }
  return best;
}
