import { describe, expect, it } from 'vitest';
import { parseGenealogicalDate } from '@chronolignee/domain';
import { HISTORICAL_CATALOGUE } from './catalogue';

/**
 * The catalogue is reference material: every entry must read as a date the
 * domain understands, run forwards, and appear once.
 */
describe('the historical catalogue', () => {
  it('has readable dates that run forwards', () => {
    for (const entry of HISTORICAL_CATALOGUE) {
      const start = parseGenealogicalDate(entry.start).interval.earliest;
      const end = parseGenealogicalDate(entry.end).interval.latest;
      expect(start, entry.title).not.toBeNull();
      expect(end, entry.title).not.toBeNull();
      expect((end ?? 0) >= (start ?? 0), entry.title).toBe(true);
    }
  });

  it('claims no more precision than history: no "about" dates', () => {
    for (const entry of HISTORICAL_CATALOGUE) {
      expect(`${entry.start} ${entry.end}`, entry.title).not.toMatch(/\bABT\b/);
    }
  });

  it('lists each event once, with a significance from 1 to 5 and a summary', () => {
    const titles = HISTORICAL_CATALOGUE.map((entry) => entry.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const entry of HISTORICAL_CATALOGUE) {
      expect(entry.significance).toBeGreaterThanOrEqual(1);
      expect(entry.significance).toBeLessThanOrEqual(5);
      expect(entry.summary.length).toBeGreaterThan(10);
    }
  });

  it('covers the demonstration family’s three centuries and two countries', () => {
    const french = HISTORICAL_CATALOGUE.filter((entry) => entry.countryCodes.includes('FR'));
    const argentine = HISTORICAL_CATALOGUE.filter((entry) => entry.countryCodes.includes('AR'));
    expect(french.length).toBeGreaterThan(40);
    expect(argentine.length).toBeGreaterThan(8);
  });
});
