import { createTranslator } from 'next-intl';
import en from '../../../messages/en.json';
import fr from '../../../messages/fr.json';
import { describe, expect, it } from 'vitest';
import {
  DEPTH_UNITS_PER_YEAR,
  centuryGuides,
  coverageSentence,
  hopSentence,
  labelPriority,
  starBrightness,
  starDepth,
  uncertaintySpan,
} from './appearance';

/**
 * The encoding a reader sees: brightness is evidence, depth is time.
 */

describe('brightness is evidence', () => {
  it('brightens with the share of sourced events', () => {
    const none = starBrightness({ hidden: false, coverage: 0 });
    const half = starBrightness({ hidden: false, coverage: 0.5 });
    const full = starBrightness({ hidden: false, coverage: 1 });
    expect(none).toBeLessThan(half);
    expect(half).toBeLessThan(full);
    expect(full).toBe(1);
  });

  it('keeps an unsourced person visible, only dim', () => {
    expect(starBrightness({ hidden: false, coverage: 0 })).toBeGreaterThan(0.2);
  });

  it('gives a hidden person no brightness their record could explain', () => {
    // Whatever their coverage would be, it is not the viewer's to see.
    expect(starBrightness({ hidden: true, coverage: 1 })).toBe(
      starBrightness({ hidden: true, coverage: 0 }),
    );
  });
});

describe('depth is time', () => {
  it('lays every star in one plane in the plan', () => {
    expect(starDepth({ yearsBefore: 180 }, 'plan')).toBe(0);
    expect(starDepth({ yearsBefore: null }, 'plan')).toBe(0);
  });

  it('pushes the past away from the viewer', () => {
    const recent = starDepth({ yearsBefore: 40 }, 'depth') as number;
    const old = starDepth({ yearsBefore: 300 }, 'depth') as number;
    expect(old).toBeLessThan(recent);
    expect(old).toBeCloseTo(-300 * DEPTH_UNITS_PER_YEAR, 9);
  });

  it('does not place an undated or hidden person in depth at all', () => {
    expect(starDepth({ yearsBefore: null }, 'depth')).toBeNull();
  });
});

describe('uncertainty in depth', () => {
  it('draws "vers 1750" as a span, and an exact date as nothing extra', () => {
    expect(uncertaintySpan({ yearsBeforeEarliest: 281, yearsBeforeLatest: 271 })).toEqual({
      near: -271 * DEPTH_UNITS_PER_YEAR,
      far: -281 * DEPTH_UNITS_PER_YEAR,
    });
    expect(uncertaintySpan({ yearsBeforeEarliest: 200.4, yearsBeforeLatest: 200.4 })).toBeNull();
  });

  it('runs a one-sided bound past its known end instead of inventing the other', () => {
    const span = uncertaintySpan({ yearsBeforeEarliest: null, yearsBeforeLatest: 276 });
    expect(span?.near).toBeCloseTo(-276 * DEPTH_UNITS_PER_YEAR, 9);
    expect(span?.far).toBeLessThan(span?.near as number);
  });
});

describe('century guides', () => {
  it('spans the centuries between the earliest birth and today', () => {
    const guides = centuryGuides([{ yearsBefore: 324 }, { yearsBefore: 50 }], 2026);
    expect(guides.map((guide) => guide.year)).toEqual([1800, 1900, 2000]);
    expect(guides[0]?.z).toBeCloseTo(-226 * DEPTH_UNITS_PER_YEAR, 9);
  });

  it('draws none when nobody is placed in depth', () => {
    expect(centuryGuides([{ yearsBefore: null }], 2026)).toEqual([]);
  });
});

describe('labels', () => {
  it('names the hovered person, then the focus, then the nearest', () => {
    const near = labelPriority({ hop: 1, coverage: 0 }, false, false);
    const far = labelPriority({ hop: 3, coverage: 1 }, false, false);
    const focus = labelPriority({ hop: 0, coverage: 0 }, true, false);
    const hovered = labelPriority({ hop: 5, coverage: 0 }, false, true);
    expect(hovered).toBeGreaterThan(focus);
    expect(focus).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
  });
});

describe('coverage in words', () => {
  /** The real catalogue, so a missing key fails here. */
  const say = (locale: 'fr' | 'en') =>
    createTranslator({
      locale,
      messages: locale === 'fr' ? fr : en,
      namespace: 'constellation',
      onError: (error) => {
        throw error;
      },
    }) as unknown as (key: string, values?: Record<string, string | number>) => string;

  it('says how much is sourced, with agreement', () => {
    const t = say('fr');
    expect(coverageSentence(t, { events: 0, cited: 0 })).toBe('aucun événement enregistré');
    expect(coverageSentence(t, { events: 1, cited: 0 })).toBe('1 événement, non sourcé');
    expect(coverageSentence(t, { events: 3, cited: 0 })).toBe('3 événements, aucun sourcé');
    expect(coverageSentence(t, { events: 4, cited: 1 })).toBe('1 événement sourcé sur 4');
    expect(coverageSentence(t, { events: 4, cited: 3 })).toBe('3 événements sourcés sur 4');
  });

  it('says the same in English', () => {
    const t = say('en');
    expect(coverageSentence(t, { events: 0, cited: 0 })).toBe('no event recorded');
    expect(coverageSentence(t, { events: 4, cited: 3 })).toBe('3 sourced events out of 4');
    expect(hopSentence(t, 0)).toBe('person at the centre');
    expect(hopSentence(t, 2)).toBe('2 links away');
  });
});
