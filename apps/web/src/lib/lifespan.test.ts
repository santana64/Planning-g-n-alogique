import { gregorianToJdn } from '@chronolignee/domain';
import { describe, expect, it } from 'vitest';
import { lifespanYears } from './lifespan';

const bounds = (from: number | null, to: number | null, inferred = false) => ({
  lifespanEarliestJdn: from,
  lifespanLatestJdn: to,
  lifespanLatestInferred: inferred,
});

describe('lifespanYears', () => {
  it('reads the year from the calendar, New Year included', () => {
    // The case that failed: a year-only birth starts on 1 January, and an
    // average-length year puts it in the year before.
    expect(lifespanYears(bounds(gregorianToJdn(1840, 1, 1), null))).toBe('1840 – ?');
    expect(lifespanYears(bounds(gregorianToJdn(1834, 6, 12), gregorianToJdn(1901, 2, 3)))).toBe(
      '1834 – 1901',
    );
    expect(lifespanYears(bounds(gregorianToJdn(1899, 12, 31), null))).toBe('1899 – ?');
  });

  it('says nothing it was not told', () => {
    expect(lifespanYears(bounds(null, null))).toBe('sans date');
    expect(lifespanYears(bounds(null, gregorianToJdn(1901, 2, 3)))).toBe('? – 1901');
    // An inferred end is the engine's bound, not a recorded death.
    expect(
      lifespanYears(bounds(gregorianToJdn(1834, 6, 12), gregorianToJdn(1954, 6, 12), true)),
    ).toBe('1834 – ?');
  });
});
