import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelCandidate } from './labels';

const VIEWPORT = { viewportWidth: 800, viewportHeight: 600 };

function label(item: string, x: number, y: number, priority: number): LabelCandidate<string> {
  return { item, x, y, width: 100, height: 16, priority };
}

describe('placing names', () => {
  it('names the most important person first when two names would collide', () => {
    const kept = placeLabels([label('cousin', 400, 300, 1), label('focus', 410, 305, 100)], {
      ...VIEWPORT,
      maxLabels: 10,
    });
    expect(kept).toEqual(['focus']);
  });

  it('keeps names that do not touch', () => {
    const kept = placeLabels(
      [label('a', 100, 100, 1), label('b', 400, 100, 1), label('c', 100, 400, 1)],
      { ...VIEWPORT, maxLabels: 10 },
    );
    expect(kept).toEqual(['a', 'b', 'c']);
  });

  it('collides in both dimensions, not only along one axis', () => {
    // Same x, well apart vertically: both fit. Same y, overlapping: one does.
    expect(
      placeLabels([label('a', 400, 100, 2), label('b', 400, 300, 1)], {
        ...VIEWPORT,
        maxLabels: 10,
      }),
    ).toEqual(['a', 'b']);
    expect(
      placeLabels([label('a', 400, 100, 2), label('b', 450, 100, 1)], {
        ...VIEWPORT,
        maxLabels: 10,
      }),
    ).toEqual(['a']);
  });

  it('leaves out a name the edge of the canvas would cut', () => {
    const kept = placeLabels([label('edge', 20, 100, 5), label('inside', 400, 100, 1)], {
      ...VIEWPORT,
      maxLabels: 10,
    });
    expect(kept).toEqual(['inside']);
  });

  it('stops at the budget, keeping the most important', () => {
    const kept = placeLabels(
      [label('low', 100, 100, 1), label('high', 400, 100, 9), label('mid', 100, 400, 5)],
      { ...VIEWPORT, maxLabels: 2 },
    );
    expect(kept).toEqual(['high', 'mid']);
  });

  it('breaks ties in the order it was given', () => {
    const kept = placeLabels([label('first', 400, 300, 1), label('second', 405, 300, 1)], {
      ...VIEWPORT,
      maxLabels: 10,
    });
    expect(kept).toEqual(['first']);
  });
});
