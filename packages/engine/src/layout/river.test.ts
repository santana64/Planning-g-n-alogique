import { describe, expect, it } from 'vitest';
import { layoutRiver, streamPath } from './river';

const life = (personId: string, branchKey: string, from: number, to: number) => ({
  personId,
  branchKey,
  earliestYear: from,
  latestYear: to,
});

describe('the river', () => {
  const rows = [
    life('a', 'root', 1700, 1760),
    life('b', 'root', 1702, 1770),
    life('c', 'left', 1730, 1800),
    life('d', 'right', 1735, 1790),
    life('e', 'right', 1760, 1830),
  ];
  const parentOf = new Map([
    ['left', 'root'],
    ['right', 'root'],
  ]);
  const river = layoutRiver({ rows, parentOf, stepYears: 1 });

  it('is as wide, at each year, as the number of lives then', () => {
    const at = (year: number) => {
      const index = river.streams[0]?.samples.findIndex((sample) => sample.year === year) ?? -1;
      return river.streams.reduce((sum, stream) => {
        const sample = stream.samples[index];
        return sum + (sample ? sample.y1 - sample.y0 : 0);
      }, 0);
    };
    expect(at(1710)).toBeCloseTo(2, 5);
    expect(at(1750)).toBeCloseTo(4, 5);
    expect(at(1820)).toBeCloseTo(1, 5);
  });

  it('opens a fork both ways around the branch it leaves', () => {
    expect(river.streams.map((stream) => stream.branchKey)).toEqual(['left', 'root', 'right']);
  });

  it('keeps every stream around the centre and its banks in order', () => {
    for (const stream of river.streams) {
      for (const sample of stream.samples) expect(sample.y1).toBeGreaterThanOrEqual(sample.y0);
    }
    const year1750 = river.streams.map(
      (stream) => stream.samples.find((sample) => sample.year === 1750) ?? { y0: 0, y1: 0 },
    );
    expect(year1750[0]?.y0).toBeCloseTo(-(year1750.at(-1)?.y1 ?? 0), 5);
  });

  it('is never wider before a branch begins', () => {
    const left = river.streams.find((stream) => stream.branchKey === 'left');
    const before = left?.samples.find((sample) => sample.year === 1720);
    expect(before ? before.y1 - before.y0 : -1).toBe(0);
    expect(left?.people).toBe(1);
    expect(left?.firstYear).toBe(1730);
  });

  it('keeps few enough samples for a long tree', () => {
    const long = layoutRiver({
      rows: [life('x', 'k', 1000, 2000)],
      parentOf: new Map(),
      maxSamples: 100,
    });
    expect(long.streams[0]?.samples.length).toBeLessThanOrEqual(102);
  });

  it('draws a closed outline', () => {
    const path = streamPath(
      river.streams[1]?.samples ?? [],
      (y) => y,
      (p) => p * 10,
    );
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).not.toContain('NaN');
  });

  it('draws nothing for a tree with no dated lives', () => {
    expect(layoutRiver({ rows: [], parentOf: new Map() }).streams).toEqual([]);
  });
});
