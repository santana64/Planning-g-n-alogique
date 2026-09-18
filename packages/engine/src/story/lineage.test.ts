import { describe, expect, it } from 'vitest';
import { gregorianToJdn } from '@chronolignee/domain';
import {
  ageBetween,
  distanceKm,
  planLineageAscent,
  type StoryDate,
  type StoryHistoricalEvent,
  type StoryPerson,
  type StoryPlace,
  type StoryScene,
} from './lineage';

/**
 * "Remonter ma lignée."
 *
 * The plan is what the story will say, before any sentence exists: each test
 * is a claim a reader would take at face value.
 */

const TOURS: StoryPlace = { id: 'tours', name: 'Tours', latitude: 47.3941, longitude: 0.6848 };
const PARIS: StoryPlace = { id: 'paris', name: 'Paris', latitude: 48.8566, longitude: 2.3522 };
const AZAY: StoryPlace = {
  id: 'azay',
  name: 'Azay-le-Rideau',
  latitude: 47.2597,
  longitude: 0.4656,
};
const NOWHERE: StoryPlace = {
  id: 'x',
  name: 'Lieu sans coordonnées',
  latitude: null,
  longitude: null,
};

function exact(year: number, month = 1, day = 1): StoryDate {
  const jdn = gregorianToJdn(year, month, day);
  return { label: `${day}/${month}/${year}`, earliestJdn: jdn, latestJdn: jdn };
}

function about(year: number): StoryDate {
  return {
    label: `vers ${year}`,
    earliestJdn: gregorianToJdn(year - 5, 1, 1),
    latestJdn: gregorianToJdn(year + 5, 12, 31),
  };
}

function person(
  id: string,
  fields: Partial<Omit<StoryPerson, 'id'>> & {
    born?: StoryDate;
    died?: StoryDate;
    at?: StoryPlace;
    migrated?: boolean;
  },
): StoryPerson {
  return {
    id,
    name: id,
    recordedSex: fields.recordedSex ?? null,
    hidden: fields.hidden ?? false,
    birth: fields.born ? { date: fields.born, place: fields.at ?? null, sources: [] } : null,
    death: fields.died ? { date: fields.died, place: null, sources: [] } : null,
    occupations: [],
    fatherId: fields.fatherId ?? null,
    motherId: fields.motherId ?? null,
    migrated: fields.migrated ?? false,
  };
}

function family(...members: StoryPerson[]): Map<string, StoryPerson> {
  return new Map(members.map((member) => [member.id, member]));
}

const kinds = (scenes: readonly StoryScene[]) => scenes.map((scene) => scene.kind);

describe('climbing a line', () => {
  const people = family(
    person('emile', { born: exact(1884, 3, 15), at: PARIS, fatherId: 'paul', motherId: 'adele' }),
    person('paul', { born: exact(1850, 3, 11), at: TOURS, fatherId: 'henri', motherId: 'celine' }),
    person('adele', { born: exact(1854, 9, 7), at: TOURS, motherId: 'rosalie' }),
    person('henri', { born: exact(1820, 1, 27), at: TOURS }),
    person('celine', { born: exact(1825, 8, 15) }),
    person('rosalie', { born: about(1790) }),
  );

  it('follows fathers on the paternal line and stops where the record does', () => {
    const plan = planLineageAscent('emile', people, [], 'paternal');
    const steps = plan?.scenes.filter((scene) => scene.kind === 'ancestor-step');
    expect(steps?.map((step) => step.kind === 'ancestor-step' && step.parentId)).toEqual([
      'paul',
      'henri',
    ]);
    expect(plan?.generations).toBe(2);
    expect(plan?.scenes.at(-1)).toEqual({
      kind: 'end',
      personId: 'henri',
      reason: 'unknown-parent',
      missing: 'father',
    });
  });

  it('follows mothers on the maternal line', () => {
    const plan = planLineageAscent('emile', people, [], 'maternal');
    const parents = plan?.scenes.flatMap((scene) =>
      scene.kind === 'ancestor-step' ? [scene.parentId] : [],
    );
    expect(parents).toEqual(['adele', 'rosalie']);
  });

  it('takes the line that reaches furthest back on the oldest line', () => {
    // Through Adèle, Rosalie was born about 1790 — before anyone on Paul's side.
    const plan = planLineageAscent('emile', people, [], 'oldest');
    const parents = plan?.scenes.flatMap((scene) =>
      scene.kind === 'ancestor-step' ? [scene.parentId] : [],
    );
    expect(parents).toEqual(['adele', 'rosalie']);
  });

  it('prefers the father when both lines reach equally far', () => {
    const plan = planLineageAscent(
      'c',
      family(
        person('c', { born: exact(1900), fatherId: 'f', motherId: 'm' }),
        person('f', { born: exact(1870) }),
        person('m', { born: exact(1870) }),
      ),
      [],
      'oldest',
    );
    expect(plan?.scenes[1]).toMatchObject({
      kind: 'ancestor-step',
      parentId: 'f',
      relation: 'father',
    });
  });

  it('opens on the subject', () => {
    expect(planLineageAscent('emile', people, [], 'paternal')?.scenes[0]).toEqual({
      kind: 'person-focus',
      personId: 'emile',
    });
  });

  it('stops at the generation limit rather than climbing a corrupted loop forever', () => {
    const loop = family(
      person('a', { born: exact(1900), fatherId: 'b' }),
      person('b', { born: exact(1870), fatherId: 'a' }),
    );
    const plan = planLineageAscent('a', loop, [], 'paternal', { maxGenerations: 5 });
    expect(plan?.generations).toBe(5);
    expect(plan?.scenes.at(-1)).toMatchObject({ kind: 'end', reason: 'limit' });
  });
});

describe('what the viewer may not see', () => {
  it('tells no story of a hidden subject', () => {
    expect(
      planLineageAscent('x', family(person('x', { hidden: true })), [], 'paternal'),
    ).toBeNull();
  });

  it('stops below a hidden parent without naming them', () => {
    const plan = planLineageAscent(
      'child',
      family(
        person('child', { born: exact(1990), fatherId: 'living' }),
        person('living', { hidden: true, born: exact(1960), fatherId: 'grandfather' }),
        person('grandfather', { born: exact(1930) }),
      ),
      [],
      'paternal',
    );
    expect(plan?.scenes.at(-1)).toEqual({
      kind: 'end',
      personId: 'child',
      reason: 'protected',
      missing: 'father',
    });
    expect(JSON.stringify(plan)).not.toContain('living');
    expect(JSON.stringify(plan)).not.toContain('grandfather');
  });

  it('does not route the oldest line around a hidden person', () => {
    // Beyond the hidden mother lies someone born in 1700; the oldest line
    // must not know that.
    const plan = planLineageAscent(
      'c',
      family(
        person('c', { born: exact(1990), fatherId: 'f', motherId: 'hidden' }),
        person('f', { born: exact(1960) }),
        person('hidden', { hidden: true, born: exact(1962), motherId: 'ancient' }),
        person('ancient', { born: exact(1700) }),
      ),
      [],
      'oldest',
    );
    expect(plan?.scenes[1]).toMatchObject({ kind: 'ancestor-step', parentId: 'f' });
  });
});

describe('ages', () => {
  it('gives a single age between two exact dates', () => {
    expect(
      ageBetween(exact(1850, 3, 11), gregorianToJdn(1884, 3, 15), gregorianToJdn(1884, 3, 15)),
    ).toEqual({ min: 34, max: 34 });
  });

  it('gives a range when a date is approximate', () => {
    const age = ageBetween(about(1790), gregorianToJdn(1820, 6, 1), gregorianToJdn(1820, 6, 1));
    expect(age?.min).toBeLessThan(age?.max ?? 0);
    expect(age).toEqual({ min: 24, max: 35 });
  });

  it('gives none when a birth is missing', () => {
    const plan = planLineageAscent(
      'c',
      family(person('c', { born: exact(1900), fatherId: 'f' }), person('f', {})),
      [],
      'paternal',
    );
    expect(plan?.scenes[1]).toMatchObject({ kind: 'ancestor-step', ageAtChildBirth: null });
  });
});

describe('moves', () => {
  it('shows a move between two recorded places far enough apart', () => {
    const plan = planLineageAscent(
      'emile',
      family(
        person('emile', { born: exact(1884), at: PARIS, fatherId: 'paul' }),
        person('paul', { born: exact(1850), at: TOURS }),
      ),
      [],
      'paternal',
    );
    const move = plan?.scenes.find((scene) => scene.kind === 'migration');
    expect(move).toMatchObject({ from: { name: 'Tours' }, to: { name: 'Paris' } });
    expect(move && move.kind === 'migration' ? move.distanceKm : 0).toBeGreaterThan(190);
  });

  it('does not call a neighbouring parish a migration', () => {
    const plan = planLineageAscent(
      'c',
      family(
        person('c', { born: exact(1884), at: TOURS, fatherId: 'f' }),
        person('f', { born: exact(1850), at: AZAY }),
      ),
      [],
      'paternal',
    );
    expect(kinds(plan?.scenes ?? [])).not.toContain('migration');
  });

  it('shows no move when a place has no coordinates', () => {
    const plan = planLineageAscent(
      'c',
      family(
        person('c', { born: exact(1884), at: PARIS, fatherId: 'f' }),
        person('f', { born: exact(1850), at: NOWHERE }),
      ),
      [],
      'paternal',
    );
    expect(kinds(plan?.scenes ?? [])).not.toContain('migration');
  });
});

describe('history', () => {
  const WAR: StoryHistoricalEvent = {
    id: 'ww1',
    title: 'Première Guerre mondiale',
    startJdn: gregorianToJdn(1914, 7, 28),
    endJdn: gregorianToJdn(1918, 11, 11),
    significance: 5,
    category: 'WAR',
  };
  const MINOR: StoryHistoricalEvent = {
    id: 'minor',
    title: 'Événement régional',
    startJdn: gregorianToJdn(1900, 1, 1),
    endJdn: gregorianToJdn(1901, 1, 1),
    significance: 2,
    category: 'POLITICAL',
  };
  const WAVE: StoryHistoricalEvent = {
    id: 'wave',
    title: 'Grande vague d’immigration européenne en Argentine',
    startJdn: gregorianToJdn(1880, 1, 1),
    endJdn: gregorianToJdn(1914, 12, 31),
    significance: 4,
    category: 'MIGRATION',
  };

  it('places someone in an event their life brackets, at the right age', () => {
    const plan = planLineageAscent(
      'x',
      family(person('x', { born: exact(1850, 3, 11), died: exact(1925) })),
      [MINOR, WAR],
      'paternal',
    );
    const context = plan?.scenes.find((scene) => scene.kind === 'historical-context');
    // The most significant of the two, and his age when it began.
    expect(context).toEqual({
      kind: 'historical-context',
      personId: 'x',
      eventId: 'ww1',
      age: { min: 64, max: 64 },
    });
  });

  it('keeps a wave of emigration for the people the record shows moving', () => {
    const stayed = planLineageAscent(
      'x',
      family(person('x', { born: exact(1825), died: exact(1900) })),
      [WAVE],
      'paternal',
    );
    expect(kinds(stayed?.scenes ?? [])).not.toContain('historical-context');

    const left = planLineageAscent(
      'x',
      family(person('x', { born: exact(1860), died: exact(1930), migrated: true })),
      [WAVE],
      'paternal',
    );
    expect(left?.scenes).toContainEqual(
      expect.objectContaining({ kind: 'historical-context', eventId: 'wave' }),
    );
  });

  it('says nothing when the death is unknown: that is not evidence of being alive', () => {
    const plan = planLineageAscent(
      'x',
      family(person('x', { born: exact(1850) })),
      [WAR],
      'paternal',
    );
    expect(kinds(plan?.scenes ?? [])).not.toContain('historical-context');
  });

  it('says nothing about an event after the death', () => {
    const plan = planLineageAscent(
      'x',
      family(person('x', { born: exact(1850), died: exact(1910) })),
      [WAR],
      'paternal',
    );
    expect(kinds(plan?.scenes ?? [])).not.toContain('historical-context');
  });

  it('does not repeat an event for the next generation up', () => {
    const plan = planLineageAscent(
      'c',
      family(
        person('c', { born: exact(1880), died: exact(1950), fatherId: 'f' }),
        person('f', { born: exact(1850), died: exact(1930) }),
      ),
      [WAR],
      'paternal',
    );
    expect(plan?.scenes.filter((scene) => scene.kind === 'historical-context')).toHaveLength(1);
  });
});

describe('distance', () => {
  it('measures along the globe', () => {
    expect(distanceKm(TOURS, PARIS)).toBeGreaterThan(200);
    expect(distanceKm(TOURS, PARIS)).toBeLessThan(215);
    const havre = { id: 'h', name: 'Le Havre', latitude: 49.4944, longitude: 0.1079 };
    const baires = { id: 'b', name: 'Buenos Aires', latitude: -34.6037, longitude: -58.3816 };
    expect(distanceKm(havre, baires)).toBeGreaterThan(10_900);
    expect(distanceKm(havre, baires)).toBeLessThan(11_200);
    expect(distanceKm(TOURS, NOWHERE)).toBeNull();
  });
});
