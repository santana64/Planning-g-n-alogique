import { describe, expect, it } from 'vitest';
import { generationBlend, generationLanes } from './render-timeline';

const YEAR = 365.2425;
const viewport = (years: number, widthPx = 1000) => ({
  startJdn: 2_400_000,
  endJdn: 2_400_000 + years * YEAR,
  widthPx,
});

describe('the generation view', () => {
  it('appears only when lives are too thin to read, and fades in', () => {
    // 1000 px for 300 years: 3.3 px a year, lives still drawn.
    expect(generationBlend(viewport(300))).toBe(0);
    // 2 px a year: halfway.
    expect(generationBlend(viewport(500))).toBeCloseTo(0.5, 5);
    // 1 px a year: generations only.
    expect(generationBlend(viewport(1000))).toBe(1);
  });

  it('gathers lives by generation, with their count and their years', () => {
    const row = (depth: number, from: number, to: number) =>
      ({ depth, earliestJdn: from, latestJdn: to }) as never;
    const lanes = generationLanes([
      row(1, 200, 300),
      row(0, 100, 150),
      row(1, 250, 400),
      { depth: 2, earliestJdn: null, latestJdn: null } as never,
    ]);
    expect(lanes).toEqual([
      { generation: 1, people: 1, startJdn: 100, endJdn: 150 },
      { generation: 2, people: 2, startJdn: 200, endJdn: 400 },
    ]);
  });
});
