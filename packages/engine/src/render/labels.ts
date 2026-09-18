/**
 * Which names to show, in two dimensions.
 *
 * The timeline's labels only ever collide along one axis; a constellation's
 * collide in the plane, and the answer has to come from priority rather than
 * position: the person at the centre is named before a third cousin, however
 * the scene happens to be turned. Greedy by priority, which is what a reader
 * expects — nothing important disappears to make room for something minor.
 */

export interface LabelCandidate<T> {
  readonly item: T;
  /** Anchor point, in screen pixels. The label box is centred horizontally on it. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Higher is placed first. */
  readonly priority: number;
}

export interface LabelPlacementOptions {
  readonly maxLabels: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** Clear space kept around every placed label. */
  readonly gapPx?: number;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function placeLabels<T>(
  candidates: readonly LabelCandidate<T>[],
  options: LabelPlacementOptions,
): T[] {
  const gap = options.gapPx ?? 4;
  const ranked = candidates
    .map((candidate, index) => ({ candidate, index }))
    // Stable: equal priorities keep the caller's order.
    .sort((a, b) => b.candidate.priority - a.candidate.priority || a.index - b.index);

  const placed: Box[] = [];
  const kept: T[] = [];

  for (const { candidate } of ranked) {
    if (kept.length >= options.maxLabels) break;
    const box: Box = {
      left: candidate.x - candidate.width / 2,
      top: candidate.y,
      right: candidate.x + candidate.width / 2,
      bottom: candidate.y + candidate.height,
    };
    // A name cut by the edge of the canvas is worse than no name.
    if (
      box.left < 0 ||
      box.top < 0 ||
      box.right > options.viewportWidth ||
      box.bottom > options.viewportHeight
    ) {
      continue;
    }
    const collides = placed.some(
      (other) =>
        box.left < other.right + gap &&
        box.right + gap > other.left &&
        box.top < other.bottom + gap &&
        box.bottom + gap > other.top,
    );
    if (collides) continue;
    placed.push(box);
    kept.push(candidate.item);
  }
  return kept;
}
