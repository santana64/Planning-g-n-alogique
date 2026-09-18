import { describe, expect, it } from 'vitest';
import {
  FAN,
  angleAt,
  annularSector,
  bandRadii,
  labelFits,
  labelPath,
  point,
  radiusFor,
} from './fan-geometry';

/**
 * Where a band lands on the page.
 */

describe('orientation', () => {
  it('opens downward: the father on the left, the eldest at the top', () => {
    const [leftX] = point(100, angleAt(0));
    const [, topY] = point(100, angleAt(0.5));
    const [rightX] = point(100, angleAt(1));
    expect(leftX).toBeLessThan(FAN.cx);
    expect(rightX).toBeGreaterThan(FAN.cx);
    // SVG's y grows downward; the top of the fan is above the centre.
    expect(topY).toBeLessThan(FAN.cy);
  });
});

describe('scale', () => {
  it('puts zero years at the edge of the centre disc and the scale at the rim', () => {
    expect(radiusFor(0, 200)).toBe(FAN.rInner);
    expect(radiusFor(200, 200)).toBe(FAN.rOuter);
  });

  it('never draws inside the subject', () => {
    // An anomalous band — born after the subject — is drawn at the disc's
    // edge and flagged, not inside the person it cannot be an ancestor of.
    expect(radiusFor(-10, 200)).toBe(FAN.rInner);
  });
});

describe('sector paths', () => {
  it('uses the large-arc flag only for a sweep over half a turn', () => {
    const narrow = annularSector(100, 150, angleAt(0), angleAt(0.25));
    const wide = annularSector(100, 150, angleAt(0), angleAt(0.9));
    // The flag is the fourth number of each arc command.
    expect(narrow).toMatch(/A 150\.00 150\.00 0 0 1/);
    expect(wide).toMatch(/A 150\.00 150\.00 0 1 1/);
  });

  it('closes the shape', () => {
    expect(annularSector(100, 150, 0, 1).endsWith('Z')).toBe(true);
  });
});

describe('names along the bands', () => {
  it('writes the upper half clockwise and turns the lower half round', () => {
    // Father's sector: mostly above the centre, reads upward — not flipped.
    expect(labelPath(120, angleAt(0), angleAt(0.5)).flipped).toBe(false);
    // Sosa 4, the bottom-left eighth: drawn clockwise it would read upside down.
    expect(labelPath(120, angleAt(0), angleAt(0.25)).flipped).toBe(true);
    // And its mirror on the mother's side.
    expect(labelPath(120, angleAt(0.75), angleAt(1)).flipped).toBe(true);
  });

  it('runs a flipped path from the far end, counter-clockwise', () => {
    const { d } = labelPath(120, angleAt(0), angleAt(0.25));
    const [endX, endY] = point(120, angleAt(0.25));
    expect(d.startsWith(`M ${endX.toFixed(2)} ${endY.toFixed(2)}`)).toBe(true);
    expect(d).toMatch(/ 0 0 0 /);
  });

  it('leaves a name off when it would be cut', () => {
    // A quarter-turn at radius 100 holds about 157 units; a name of 30
    // characters needs about 174.
    expect(labelFits('Émile MOREAU', 100, 0, Math.PI / 2)).toBe(true);
    expect(labelFits('x'.repeat(30), 100, 0, Math.PI / 2)).toBe(false);
    expect(labelFits('', 100, 0, Math.PI / 2)).toBe(false);
  });
});

describe('band radii', () => {
  const scale = 200;

  it('gives a hairline a visible minimum width', () => {
    const radii = bandRadii(
      { innerYears: 30, outerYears: 30, innerOpen: false, outerOpen: false },
      scale,
    );
    expect(radii.outer - radii.inner).toBeCloseTo(FAN.minBandPx, 5);
  });

  it('runs an open outer end past its known edge', () => {
    const closed = bandRadii(
      { innerYears: 60, outerYears: 70, innerOpen: false, outerOpen: false },
      scale,
    );
    const open = bandRadii(
      { innerYears: 60, outerYears: 70, innerOpen: false, outerOpen: true },
      scale,
    );
    expect(open.outer).toBeGreaterThan(closed.outer);
    expect(open.inner).toBe(closed.inner);
  });

  it('never runs past the rim', () => {
    const radii = bandRadii(
      { innerYears: 195, outerYears: 200, innerOpen: false, outerOpen: true },
      scale,
    );
    expect(radii.outer).toBeLessThanOrEqual(FAN.rOuter);
  });
});
