import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUPLICATE_THRESHOLD,
  nameSimilarity,
  rankDuplicatePairs,
  scoreDuplicate,
  type DuplicateSubject,
} from './duplicates';

const year = (y: number): { earliest: number; latest: number } => ({
  // 1 January to 31 December of that year, in round julian days.
  earliest: 1_721_060 + Math.round(y * 365.2425),
  latest: 1_721_060 + Math.round((y + 1) * 365.2425) - 1,
});

function person(overrides: Partial<DuplicateSubject> & { id: string }): DuplicateSubject {
  return {
    surname: 'chassagne',
    given: 'jean',
    recordedSex: 'MALE',
    birth: year(1820),
    death: null,
    birthPlace: 'tours',
    parentIds: [],
    partnerIds: [],
    childIds: [],
    ...overrides,
  };
}

describe('scoring a pair', () => {
  it('recognises the same person imported twice', () => {
    const scored = scoreDuplicate(person({ id: 'a' }), person({ id: 'b' }));
    expect(scored.score).toBeGreaterThan(0.95);
    expect(scored.signals.map((signal) => signal.name)).toContain('birth');
  });

  it('tolerates a spelling and a year of difference', () => {
    const scored = scoreDuplicate(
      person({ id: 'a', surname: 'chassagne', given: 'jean baptiste', birth: year(1820) }),
      person({ id: 'b', surname: 'chassaigne', given: 'jean-baptiste', birth: year(1821) }),
    );
    expect(scored.score).toBeGreaterThan(DEFAULT_DUPLICATE_THRESHOLD);
  });

  it('refuses two homonyms born a generation apart, whatever else they share', () => {
    // The same name in the same town, thirty years apart: usually a father
    // and a son the tree has not linked yet. Merging them loses a generation.
    expect(
      scoreDuplicate(
        person({ id: 'a', birth: year(1820) }),
        person({ id: 'b', birth: year(1850) }),
      ),
    ).toMatchObject({ score: 0, refusedBecause: 'DATES_EXCLUDE_IT' });
  });

  it('still recognises a pair whose dates differ by a couple of years', () => {
    const scored = scoreDuplicate(
      person({ id: 'a', birth: year(1877) }),
      person({ id: 'b', birth: year(1879) }),
    );
    expect(scored.score).toBeGreaterThan(DEFAULT_DUPLICATE_THRESHOLD);
  });

  it('refuses a father and his son outright, however alike they read', () => {
    const father = person({ id: 'father', childIds: ['son'], birth: year(1820) });
    const son = person({ id: 'son', parentIds: ['father'], birth: year(1845) });
    expect(scoreDuplicate(father, son)).toMatchObject({
      score: 0,
      refusedBecause: 'DIRECTLY_RELATED',
    });
  });

  it('refuses a pair the register sexes differently', () => {
    expect(
      scoreDuplicate(
        person({ id: 'a', recordedSex: 'MALE' }),
        person({ id: 'b', recordedSex: 'FEMALE' }),
      ),
    ).toMatchObject({ refusedBecause: 'RECORDED_SEX_DIFFERS' });
  });

  it('judges on what both records say, not on what is missing', () => {
    // Neither has dates: the score rests on the names and the place, and the
    // absent signals are not counted as disagreements.
    const scored = scoreDuplicate(
      person({ id: 'a', birth: null, death: null }),
      person({ id: 'b', birth: null, death: null }),
    );
    expect(scored.signals.map((s) => s.name)).toEqual(['surname', 'given', 'birthPlace']);
    expect(scored.score).toBe(1);
  });

  it('counts shared parents and children', () => {
    const scored = scoreDuplicate(
      person({ id: 'a', given: 'marie', parentIds: ['p1', 'p2'], childIds: ['c1'] }),
      person({ id: 'b', given: 'marie anne', parentIds: ['p1', 'p2'], childIds: ['c1', 'c2'] }),
    );
    const parents = scored.signals.find((signal) => signal.name === 'parents');
    expect(parents?.value).toBe(1);
    expect(scored.signals.find((signal) => signal.name === 'children')?.value).toBeCloseTo(0.5);
  });
});

describe('name similarity', () => {
  it('is 1 for the same string and 0 when one is missing', () => {
    expect(nameSimilarity('dupont', 'dupont')).toBe(1);
    expect(nameSimilarity('', 'dupont')).toBe(0);
  });

  it('is symmetric and bounded, whatever the strings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const forward = nameSimilarity(a, b);
        expect(forward).toBe(nameSimilarity(b, a));
        expect(forward).toBeGreaterThanOrEqual(0);
        expect(forward).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('ranking candidate pairs', () => {
  const subjects = new Map(
    [
      person({ id: 'a' }),
      person({ id: 'b' }),
      person({ id: 'c', given: 'sophie', recordedSex: 'FEMALE', birth: year(1901) }),
    ].map((subject) => [subject.id, subject]),
  );

  it('keeps a pair once, in a stable order, above the threshold only', () => {
    const ranked = rankDuplicatePairs(subjects, [
      ['b', 'a'],
      ['a', 'b'],
      ['a', 'c'],
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ leftId: 'a', rightId: 'b' });
  });

  it('ignores a pair naming someone it was not given', () => {
    expect(rankDuplicatePairs(subjects, [['a', 'ghost']])).toEqual([]);
  });

  it('is symmetric: the order a pair arrives in changes nothing', () => {
    fc.assert(
      fc.property(fc.constantFrom('a', 'b', 'c'), fc.constantFrom('a', 'b', 'c'), (x, y) => {
        expect(rankDuplicatePairs(subjects, [[x, y]])).toEqual(
          rankDuplicatePairs(subjects, [[y, x]]),
        );
      }),
    );
  });
});
