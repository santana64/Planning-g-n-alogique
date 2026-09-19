import { describe, expect, it } from 'vitest';
import { gregorianToJdn } from '@chronolignee/domain';
import { chooseStoriesByRules, findStoryCandidates, type StoryCandidate } from './director';
import type { StoryDate, StoryPerson, StoryPlace } from './lineage';

/**
 * The Director finds what is worth telling. Each test is a pattern a reader
 * would be shown — and each negative test a pattern it must not invent.
 */

const TOURS: StoryPlace = { id: 'tours', name: 'Tours', latitude: 47.3941, longitude: 0.6848 };
const AZAY: StoryPlace = {
  id: 'azay',
  name: 'Azay-le-Rideau',
  latitude: 47.2597,
  longitude: 0.4656,
};
const BUENOS_AIRES: StoryPlace = {
  id: 'ba',
  name: 'Buenos Aires',
  latitude: -34.6037,
  longitude: -58.3816,
};

function on(year: number): StoryDate {
  const jdn = gregorianToJdn(year, 6, 1);
  return { label: String(year), earliestJdn: jdn, latestJdn: jdn };
}

function person(
  id: string,
  fields: {
    born?: number;
    died?: number;
    at?: StoryPlace;
    father?: string;
    mother?: string;
    hidden?: boolean;
    sex?: 'MALE' | 'FEMALE';
  },
): StoryPerson {
  return {
    id,
    name: id,
    recordedSex: fields.sex ?? null,
    hidden: fields.hidden ?? false,
    birth: fields.born ? { date: on(fields.born), place: fields.at ?? null, sources: [] } : null,
    death: fields.died ? { date: on(fields.died), place: null, sources: [] } : null,
    occupations: [],
    fatherId: fields.father ?? null,
    motherId: fields.mother ?? null,
    migrated: false,
  };
}

function input(people: StoryPerson[], coverage: [string, number, number][] = []) {
  return {
    people: new Map(people.map((p) => [p.id, p])),
    coverage: new Map(coverage.map(([id, events, cited]) => [id, { events, cited }])),
    historical: [],
  };
}

const kinds = (candidates: readonly StoryCandidate[]) => candidates.map((c) => c.facts.kind);

describe('migrations', () => {
  it('finds a move across an ocean, from where the parent was born to where the child was', () => {
    const candidates = findStoryCandidates(
      input([
        person('gustave', { born: 1840, at: TOURS, sex: 'MALE' }),
        person('ricardo', { born: 1875, at: BUENOS_AIRES, father: 'gustave' }),
      ]),
    );
    const move = candidates.find((c) => c.facts.kind === 'migration');
    expect(move?.facts).toMatchObject({ from: 'Tours', to: 'Buenos Aires' });
    expect(move?.facts.kind === 'migration' && move.facts.distanceKm).toBeGreaterThan(10_000);
    // Told by the same planner as any climb: the child, then the parent.
    expect(move?.plan.scenes[0]).toEqual({ kind: 'person-focus', personId: 'ricardo' });
  });

  it('does not make a story of a move to the next parish', () => {
    const candidates = findStoryCandidates(
      input([
        person('p', { born: 1840, at: AZAY }),
        person('c', { born: 1870, at: TOURS, father: 'p' }),
      ]),
    );
    expect(kinds(candidates)).not.toContain('migration');
  });

  it('tells a route once, through the first family to take it', () => {
    const candidates = findStoryCandidates(
      input([
        person('p', { born: 1840, at: TOURS }),
        person('elder', { born: 1870, at: BUENOS_AIRES, father: 'p' }),
        person('younger', { born: 1874, at: BUENOS_AIRES, father: 'p' }),
      ]),
    );
    const moves = candidates.filter((c) => c.facts.kind === 'migration');
    expect(moves).toHaveLength(1);
    expect(moves[0]?.subjectId).toBe('elder');
  });

  it('never builds a pattern on someone the viewer may not see', () => {
    const candidates = findStoryCandidates(
      input([
        person('p', { born: 1940, at: TOURS, hidden: true }),
        person('c', { born: 1975, at: BUENOS_AIRES, father: 'p' }),
      ]),
    );
    expect(kinds(candidates)).not.toContain('migration');
  });
});

describe('four generations', () => {
  const chain = [
    person('a', { born: 1900, died: 1980, father: 'b' }),
    person('b', { born: 1875, died: 1950, mother: 'c' }),
    person('c', { born: 1850, died: 1930, father: 'd' }),
    person('d', { born: 1825, died: 1905 }),
  ];

  it('finds the years all four were certainly alive', () => {
    const candidate = findStoryCandidates(input(chain)).find(
      (c) => c.facts.kind === 'four-generations',
    );
    expect(candidate?.facts).toEqual({
      kind: 'four-generations',
      personIds: ['a', 'b', 'c', 'd'],
      fromYear: 1900,
      toYear: 1905,
    });
    // The plan climbs exactly that way: father, mother, father.
    expect(
      candidate?.plan.scenes.flatMap((scene) =>
        scene.kind === 'ancestor-step' ? [scene.parentId] : [],
      ),
    ).toEqual(['b', 'c', 'd']);
  });

  it('claims nothing when a death is unknown: that is not a long life', () => {
    const unknown = chain.map((p) => (p.id === 'd' ? { ...p, death: null } : p));
    expect(kinds(findStoryCandidates(input(unknown)))).not.toContain('four-generations');
  });
});

describe('documentation and depth', () => {
  it('singles out the best-documented life, with enough events to mean it', () => {
    const candidates = findStoryCandidates(
      input(
        [person('thin', { born: 1850 }), person('rich', { born: 1850 })],
        [
          ['thin', 1, 1],
          ['rich', 5, 5],
        ],
      ),
    );
    const documented = candidates.find((c) => c.facts.kind === 'well-documented');
    expect(documented?.subjectId).toBe('rich');
  });

  it('finds the line that goes deepest, from the end of a line', () => {
    const candidates = findStoryCandidates(
      input([
        person('now', { born: 1950, father: 'g1' }),
        person('g1', { born: 1920, father: 'g2' }),
        person('g2', { born: 1890, father: 'g3' }),
        person('g3', { born: 1860 }),
      ]),
    );
    const deep = candidates.find((c) => c.facts.kind === 'deep-line');
    expect(deep?.subjectId).toBe('now');
    expect(deep?.facts).toMatchObject({ generations: 3, earliestYear: 1860 });
  });
});

describe('the rules’ choice', () => {
  it('ranks by strength and tells no one’s story twice', () => {
    const candidates = findStoryCandidates(
      input(
        [
          person('gustave', { born: 1840, at: TOURS }),
          person('ricardo', { born: 1875, at: BUENOS_AIRES, father: 'gustave' }),
        ],
        [['ricardo', 4, 4]],
      ),
    );
    const chosen = chooseStoriesByRules(candidates, 4);
    const subjects = chosen.map((c) => c.subjectId);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(chosen[0]?.facts.kind).toBe('migration');
  });

  it('is the same choice every time', () => {
    const people = input([
      person('gustave', { born: 1840, at: TOURS }),
      person('ricardo', { born: 1875, at: BUENOS_AIRES, father: 'gustave' }),
    ]);
    const first = chooseStoriesByRules(findStoryCandidates(people)).map((c) => c.id);
    const second = chooseStoriesByRules(findStoryCandidates(people)).map((c) => c.id);
    expect(second).toEqual(first);
  });
});
