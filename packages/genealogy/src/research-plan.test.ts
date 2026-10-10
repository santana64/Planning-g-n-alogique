import { describe, expect, it } from 'vitest';
import { FRENCH_CENSUSES, researchPlan, type PlanEvent, type PlanSubject } from './research-plan';

/**
 * The research plan, rule by rule — including the cases where a rule must
 * stay silent, because a plan that suggests the wrong archive wastes an
 * afternoon in a reading room.
 */

const event = (
  year: number | null,
  place: string | null,
  sourced = true,
  approximate = false,
): PlanEvent => ({
  year,
  place,
  sourced,
  approximate,
});

function subject(overrides: Partial<PlanSubject> = {}): PlanSubject {
  return {
    sex: 'MALE',
    isLiving: false,
    birth: null,
    baptism: null,
    death: null,
    burial: null,
    marriages: [],
    parentsKnown: 2,
    childrenKnown: 0,
    places: [],
    ...overrides,
  };
}

const kinds = (s: PlanSubject, year = 2026) => researchPlan(s, year).map((step) => step.kind);

describe('a generation further up', () => {
  it('looks for the parents in the marriage act, which names them', () => {
    const steps = researchPlan(
      subject({
        parentsKnown: 0,
        birth: event(1822, 'Tours'),
        marriages: [{ ...event(1849, 'Tours'), spouse: 'Rosalie' }],
      }),
      2026,
    );
    expect(steps[0]).toMatchObject({
      kind: 'PARENTS_FROM_MARRIAGE',
      params: { place: 'Tours', year: 1849 },
    });
  });

  it('falls back to the birth act when no marriage is recorded', () => {
    expect(kinds(subject({ parentsKnown: 1, birth: event(1822, 'Tours') }))).toContain(
      'PARENTS_FROM_BIRTH',
    );
  });

  it('says nothing about parents already recorded', () => {
    expect(kinds(subject({ birth: event(1822, 'Tours') }))).not.toContain('PARENTS_FROM_BIRTH');
  });
});

describe('which registers for a birth', () => {
  it('sends a birth before 1792 to the parish registers', () => {
    expect(kinds(subject({ birth: event(1768, 'Azay-le-Rideau', false) }))).toContain(
      'BIRTH_PARISH',
    );
  });

  it('sends a birth after 1792 to the état civil', () => {
    expect(kinds(subject({ birth: event(1822, 'Tours', false) }))).toContain('BIRTH_SOURCE');
    expect(kinds(subject({ birth: event(1822, 'Tours', true, true) }))).toContain('BIRTH_CIVIL');
  });

  it('estimates the birth from a first marriage when it is not known', () => {
    const steps = researchPlan(
      subject({ marriages: [{ ...event(1790, 'Saché'), spouse: null }] }),
      2026,
    );
    const birth = steps.find((step) => step.id === 'birth-find');
    expect(birth?.kind).toBe('BIRTH_PARISH');
    expect([birth?.from, birth?.to]).toEqual([1755, 1770]);
  });
});

describe('a death', () => {
  it('reads a twentieth-century death in the margin of the birth act', () => {
    expect(kinds(subject({ birth: event(1908, 'Tours') }))).toContain('DEATH_MARGIN');
  });

  it('looks for an older death in the ten-year indexes of the last place', () => {
    const steps = researchPlan(
      subject({ birth: event(1820, 'Tours'), places: [{ place: 'Saché', year: 1860 }] }),
      2026,
    );
    expect(steps.find((step) => step.kind === 'DEATH_FIND')?.params).toMatchObject({
      place: 'Saché',
    });
  });

  it('asks for the act of a death recorded without a source', () => {
    expect(
      kinds(subject({ birth: event(1820, 'Tours'), death: event(1880, 'Tours', false) })),
    ).toContain('DEATH_SOURCE');
  });

  it('suggests the succession declaration, which exists from 1791 to the 1960s', () => {
    expect(kinds(subject({ birth: event(1820, 'Tours'), death: event(1880, 'Tours') }))).toContain(
      'SUCCESSION',
    );
    expect(
      kinds(subject({ birth: event(1900, 'Tours'), death: event(1990, 'Tours') })),
    ).not.toContain('SUCCESSION');
  });
});

describe('censuses and military registers', () => {
  it('lists the censuses the life spans, with 1872 and without 1916', () => {
    const census = researchPlan(
      subject({ birth: event(1860, 'Tours'), death: event(1920, 'Tours') }),
      2026,
    ).find((step) => step.kind === 'CENSUS');
    expect(census?.params['years']).toBe(
      '1861, 1866, 1872, 1876, 1881, 1886, 1891, 1896, 1901, 1906, 1911',
    );
    expect(FRENCH_CENSUSES).not.toContain(1916);
    expect(FRENCH_CENSUSES).not.toContain(1871);
  });

  it('places a man in the class of the year he turned twenty', () => {
    const military = researchPlan(subject({ birth: event(1882, 'Tours') }), 2026).find(
      (step) => step.kind === 'MILITARY',
    );
    expect(military?.params['class']).toBe(1902);
  });

  it('does not send a woman, or a man born too early, to the military registers', () => {
    expect(kinds(subject({ sex: 'FEMALE', birth: event(1882, 'Tours') }))).not.toContain(
      'MILITARY',
    );
    expect(kinds(subject({ birth: event(1820, 'Tours') }))).not.toContain('MILITARY');
  });
});

describe('a living person', () => {
  it('gets no plan that searches for their death or their papers', () => {
    expect(
      kinds(subject({ isLiving: true, parentsKnown: 0, birth: event(1980, 'Tours') })),
    ).toEqual(['PARENTS_FROM_BIRTH']);
  });
});
