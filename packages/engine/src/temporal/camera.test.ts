import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { gregorianToJdn } from '@chronolignee/domain';
import { TemporalCamera, interpolateCamera } from './camera';
import { barGeometry, daysPerPixel, pixelsPerYear, temporalTicks } from './scale';

const WIDTH = 1200;
const y = (year: number) => gregorianToJdn(year, 1, 1);

function camera(fromYear = 1700, toYear = 2030) {
  return new TemporalCamera({ startJdn: y(fromYear), endJdn: y(toYear), widthPx: WIDTH });
}

describe('projection', () => {
  it('maps the ends of the viewport to the ends of the screen', () => {
    const c = camera();
    expect(c.toX(y(1700))).toBeCloseTo(0, 6);
    expect(c.toX(y(2030))).toBeCloseTo(WIDTH, 6);
  });

  it('round-trips a pixel through time and back', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: WIDTH, noNaN: true }), (x) => {
        const c = camera();
        expect(c.toX(c.toJdn(x))).toBeCloseTo(x, 6);
      }),
    );
  });

  it('is linear in days, not in years', () => {
    const c = camera();
    // Two spans of equal day count must occupy equal width, whatever leap
    // years they contain. A year-linear axis fails this.
    const a = c.toX(y(1801)) - c.toX(y(1800));
    const b = c.toX(y(1901)) - c.toX(y(1900));
    const leapDifference = (366 - 365) / 365.2425;
    expect(Math.abs(a - b)).toBeLessThan(a * leapDifference * 1.5);
  });
});

describe('zoom', () => {
  it('always leaves the viewport valid, whatever the zoom', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: WIDTH, noNaN: true }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        (focusPx, factor) => {
          const c = camera();
          c.zoomAt(focusPx, factor);
          const v = c.viewport();

          expect(v.startJdn).toBeGreaterThanOrEqual(990_000 - 1e-6);
          expect(v.endJdn).toBeLessThanOrEqual(2_816_788 + 1e-6);
          expect(c.spanDays).toBeGreaterThanOrEqual(7 - 1e-6);
          expect(Number.isFinite(c.spanDays)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('keeps the anchor unless the view is pinned against a limit', () => {
    // The anchor is a promise the camera can only keep while it has room.
    // Pinned against the end of the permitted range there is no framing that
    // preserves it, and sliding is the correct answer — so the property is
    // conditional rather than absolute. Asserting it unconditionally would
    // either be false or force the camera to scroll past year 2200.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: WIDTH, noNaN: true }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        (focusPx, factor) => {
          const c = camera();
          const before = c.toJdn(focusPx);
          c.zoomAt(focusPx, factor);

          const v = c.viewport();
          const pinned =
            Math.abs(v.startJdn - 990_000) < 1 ||
            Math.abs(v.endJdn - 2_816_788) < 1 ||
            Math.abs(c.spanDays - 7) < 1;

          if (!pinned) expect(c.toJdn(focusPx)).toBeCloseTo(before, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('holds the anchor exactly when nothing is clamped', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: WIDTH, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        (focusPx, factor) => {
          // Well inside every limit, so no clamping can interfere.
          const c = new TemporalCamera(
            { startJdn: y(1800), endJdn: y(1900), widthPx: WIDTH },
            { minJdn: y(1000), maxJdn: y(2100) },
          );
          const before = c.toJdn(focusPx);
          c.zoomAt(focusPx, factor);
          expect(c.toJdn(focusPx)).toBeCloseTo(before, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('gives up the anchor rather than scrolling past the end of time', () => {
    // Pinned against the upper bound, no framing preserves the anchor: the
    // view cannot extend past year 2200 in order to keep it. Sliding is the
    // correct answer, and the slide is exactly the overshoot — about a pixel
    // at this zoom, which is why it is invisible in practice.
    const c = camera();
    const before = c.toJdn(0);
    c.zoomAt(0, 3.94);

    expect(c.viewport().endJdn).toBeCloseTo(2_816_788, 0);
    const drift = Math.abs(c.toJdn(0) - before);
    expect(drift).toBeGreaterThan(0);
    // Within a couple of pixels: the slide is the overshoot past the bound,
    // not accumulated error.
    expect(drift).toBeLessThanOrEqual(daysPerPixel(c.viewport()) * 2);
  });

  it('does not drift the anchor over many small steps', () => {
    const c = camera();
    const focusPx = 400;
    const before = c.toJdn(focusPx);
    for (let i = 0; i < 200; i += 1) c.zoomAt(focusPx, 0.97);
    expect(Math.abs(c.toJdn(focusPx) - before)).toBeLessThan(1);
  });

  it('stops at the narrowest permitted span', () => {
    const c = camera();
    for (let i = 0; i < 400; i += 1) c.zoomAt(WIDTH / 2, 0.8);
    expect(c.spanDays).toBeGreaterThanOrEqual(7);
  });

  it('stops at the widest permitted span', () => {
    const c = camera();
    for (let i = 0; i < 400; i += 1) c.zoomBy(1.25);
    expect(c.spanDays).toBeLessThanOrEqual(2200 * 365.2425 + 1);
  });

  it('keeps the centre when a zoom is clamped', () => {
    const c = camera(1900, 1901);
    const centre = c.centreJdn;
    // Already near the minimum span; zooming further must not slide sideways.
    c.zoomBy(0.001);
    expect(Math.abs(c.centreJdn - centre)).toBeLessThan(1);
  });
});

describe('pan', () => {
  it('moves the view opposite to the drag, as a dragged surface does', () => {
    const c = camera();
    const before = c.centreJdn;
    c.panByPixels(100);
    expect(c.centreJdn).toBeLessThan(before);
  });

  it('is reversible', () => {
    const c = camera();
    const before = c.centreJdn;
    c.panByPixels(250);
    c.panByPixels(-250);
    expect(c.centreJdn).toBeCloseTo(before, 6);
  });

  it('never escapes the permitted bounds', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -5000, max: 5000 }), { maxLength: 40 }), (steps) => {
        const c = new TemporalCamera(
          { startJdn: y(1800), endJdn: y(1900), widthPx: WIDTH },
          { minJdn: y(1700), maxJdn: y(2000) },
        );
        for (const step of steps) c.panByPixels(step);
        expect(c.viewport().startJdn).toBeGreaterThanOrEqual(y(1700) - 1e-6);
        expect(c.viewport().endJdn).toBeLessThanOrEqual(y(2000) + 1e-6);
      }),
      { numRuns: 300 },
    );
  });
});

describe('fit', () => {
  it('frames a range with padding on both sides', () => {
    const c = camera();
    c.fitRange(y(1850), y(1900), 0.1);
    expect(c.viewport().startJdn).toBeLessThan(y(1850));
    expect(c.viewport().endJdn).toBeGreaterThan(y(1900));
  });

  it('gives a single-day life a readable window instead of infinite zoom', () => {
    const c = camera();
    // An infant who died the day they were born has a zero-width lifespan.
    c.fitRange(y(1850), y(1850));
    expect(c.spanDays).toBeGreaterThan(30);
    expect(Number.isFinite(c.spanDays)).toBe(true);
  });

  it('shows the whole permitted range when asked for more than exists', () => {
    const c = new TemporalCamera(
      { startJdn: y(1800), endJdn: y(1900), widthPx: WIDTH },
      { minJdn: y(1700), maxJdn: y(2000) },
    );
    c.fitRange(y(1000), y(2500));
    expect(c.viewport().startJdn).toBeCloseTo(y(1700), 6);
    expect(c.viewport().endJdn).toBeCloseTo(y(2000), 6);
  });
});

describe('interpolation', () => {
  it('starts and ends exactly on the endpoints', () => {
    const from = camera(1700, 2030).snapshot();
    const to = camera(1900, 1910).snapshot();
    expect(interpolateCamera(from, to, 0).startJdn).toBeCloseTo(from.startJdn, 6);
    expect(interpolateCamera(from, to, 1).startJdn).toBeCloseTo(to.startJdn, 6);
  });

  it('changes the span geometrically, so a long zoom feels even', () => {
    const from = { startJdn: y(1000), endJdn: y(2000), widthPx: WIDTH };
    const to = { startJdn: y(1899), endJdn: y(1901), widthPx: WIDTH };

    const halfway = interpolateCamera(from, to, 0.5);
    const span = halfway.endJdn - halfway.startJdn;
    const fromSpan = from.endJdn - from.startJdn;
    const toSpan = to.endJdn - to.startJdn;

    // The geometric mean, not the arithmetic one. Linear interpolation would
    // put this at roughly half the starting span, which reads as a lurch.
    expect(span).toBeCloseTo(Math.sqrt(fromSpan * toSpan), -1);
    expect(span).toBeLessThan((fromSpan + toSpan) / 4);
  });
});

describe('bar geometry', () => {
  const viewport = camera().viewport();

  it('gives a closed bar for a fully known life', () => {
    const bar = barGeometry(viewport, { earliest: y(1800), latest: y(1870) });
    expect(bar.openLeft).toBe(false);
    expect(bar.openRight).toBe(false);
    expect(bar.width).toBeGreaterThan(0);
  });

  it('runs an unrecorded death off the right edge rather than inventing one', () => {
    const bar = barGeometry(viewport, { earliest: y(1800), latest: null });
    expect(bar.openRight).toBe(true);
    expect(bar.x + bar.width).toBeGreaterThan(viewport.widthPx);
  });

  it('keeps a same-day birth and death visible', () => {
    const bar = barGeometry(viewport, { earliest: y(1800), latest: y(1800) });
    expect(bar.visible).toBe(true);
    expect(bar.width).toBeGreaterThanOrEqual(1);
  });

  it('reports a person with no dates as not drawable', () => {
    expect(barGeometry(viewport, { earliest: null, latest: null }).visible).toBe(false);
  });

  it('culls a life entirely outside the viewport', () => {
    expect(barGeometry(viewport, { earliest: y(1000), latest: y(1100) }).visible).toBe(false);
  });
});

describe('ticks', () => {
  it('rules three centuries in centuries, not in years', () => {
    const ticks = temporalTicks(camera(1700, 2030).viewport());
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThan(40);
    expect(ticks.every((t) => t.year % 10 === 0)).toBe(true);
  });

  it('rules a single year in months', () => {
    const c = camera(1900, 1901);
    const ticks = temporalTicks(c.viewport());
    expect(ticks.some((t) => t.unit === 'MONTH')).toBe(true);
  });

  it('never crowds labels below the minimum spacing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1700, max: 1990 }),
        fc.integer({ min: 1, max: 300 }),
        (from, span) => {
          const c = camera(from, from + span);
          const ticks = temporalTicks(c.viewport(), 72);
          for (let i = 1; i < ticks.length; i += 1) {
            const gap = (ticks[i]?.x ?? 0) - (ticks[i - 1]?.x ?? 0);
            expect(gap).toBeGreaterThanOrEqual(60);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('always produces at least one tick for a normal view', () => {
    expect(temporalTicks(camera(1850, 1950).viewport()).length).toBeGreaterThan(0);
  });

  it('reports a sane scale', () => {
    expect(pixelsPerYear(camera(1700, 2030).viewport())).toBeGreaterThan(1);
    expect(pixelsPerYear(camera(1900, 1901).viewport())).toBeGreaterThan(1000);
  });
});
