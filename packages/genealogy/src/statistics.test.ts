import { describe, expect, it } from 'vitest';
import { parseGenealogicalDate } from '@chronolignee/domain';
import { GenealogyGraph, type GraphEdge, type GraphPerson } from './graph';
import { atAge, distribution, haversineKm, treeStatistics } from './statistics';

const date = (text: string) => parseGenealogicalDate(text);
let edgeId = 0;
const parent = (parentId: string, childId: string): GraphEdge => ({
  id: `e${(edgeId += 1)}`,
  sourceId: parentId,
  targetId: childId,
  type: 'PARENT_BIOLOGICAL',
});

function person(
  id: string,
  sex: GraphPerson['recordedSex'],
  birth: string | null,
  death: string | null,
  marriage?: string,
): GraphPerson {
  return {
    id,
    displayName: id,
    recordedSex: sex,
    birth: birth ? date(birth) : null,
    death: death ? date(death) : null,
    events: marriage
      ? [{ eventId: `m-${id}`, type: 'MARRIAGE', role: 'SPOUSE', date: date(marriage) }]
      : [],
  };
}

// Three generations: Jean and Marie, their children Pierre and Louise,
// Pierre's son Paul. One record with an approximate birth.
const people = [
  person('jean', 'MALE', '3 MAR 1800', '10 JAN 1870', '12 MAY 1825'),
  person('marie', 'FEMALE', '1805', '1880', '12 MAY 1825'),
  person('pierre', 'MALE', '1827', '1900', '1855'),
  person('louise', 'FEMALE', '1830', '1832'),
  person('paul', 'MALE', '1856', null),
  person('vague', 'UNKNOWN', 'ABT 1700', '1771'),
];
const edges = [
  parent('jean', 'pierre'),
  parent('marie', 'pierre'),
  parent('jean', 'louise'),
  parent('marie', 'louise'),
  parent('pierre', 'paul'),
];
const graph = new GenealogyGraph(people, edges);
const everyone = () => true;

describe('treeStatistics', () => {
  const stats = treeStatistics({ graph, include: everyone });

  it('counts the recorded people by sex, and the generations of the longest line', () => {
    expect(stats.people).toBe(6);
    expect(stats.bySex).toEqual({ female: 2, male: 3, other: 1 });
    expect(stats.generations).toBe(3);
    expect(stats.earliestYear).toBeLessThanOrEqual(1700);
  });

  it('measures lifespans only between dates known to the year', () => {
    // Jean 69, Marie 74, Pierre 73, Louise 1 — "about 1700" is left out.
    expect(stats.lifespan.count).toBe(4);
    expect(stats.lifespan.median).toBe(71);
    // Louise, "1830" to "1832": midpoint to midpoint, and 1832 is a leap
    // year, so one year and 364 days — an age of 1, not 2.
    expect(stats.lifespan.min).toBe(1);
  });

  it('keeps the axis continuous: an empty decade or age band is a zero, not a gap', () => {
    expect(stats.lifespan.bands.map((band) => band.from)).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    const decades = stats.birthsByDecade.map((row) => row.decade);
    expect(decades).toEqual([1800, 1810, 1820, 1830, 1840, 1850]);
  });

  it('measures the age at a first marriage, separately for women and men', () => {
    expect(stats.marriageAge.male.count).toBe(2);
    expect(stats.marriageAge.male.median).toBe(26.5); // 25 and 28
    expect(stats.marriageAge.female.median).toBe(19);
  });

  it('counts the children of each couple whose two parents are recorded', () => {
    expect(stats.childrenPerCouple.count).toBe(1);
    // From one child up, with the empty steps written as zero.
    expect(stats.childrenPerCouple.bands).toEqual([
      { children: 1, couples: 0 },
      { children: 2, couples: 1 },
    ]);
  });

  it('includes nobody the caller excluded, not even in the generations', () => {
    const without = treeStatistics({ graph, include: (id) => id !== 'paul' });
    expect(without.people).toBe(5);
    expect(without.generations).toBe(2);
  });

  it('ranks given names case-insensitively, and measures a migration', () => {
    const named = treeStatistics({
      graph,
      include: everyone,
      givenNames: new Map([
        ['jean', 'Jean'],
        ['pierre', 'jean'],
        ['paul', 'Paul'],
      ]),
      birthPlaces: new Map([['pierre', { label: 'Tours', latitude: 47.394, longitude: 0.684 }]]),
      deathPlaces: new Map([['pierre', { label: 'Paris', latitude: 48.857, longitude: 2.352 }]]),
    });
    expect(named.givenNames.male[0]).toEqual({ label: 'Jean', count: 2 });
    expect(named.migration.count).toBe(1);
    expect(named.migration.longest?.km).toBeGreaterThan(200);
    expect(named.migration.longest?.km).toBeLessThan(220);
  });
});

describe('atAge', () => {
  it('compares the same age up the father’s line', () => {
    const rows = atAge(graph, 'paul', 30, 'FATHER', everyone);
    expect(rows.map((row) => row.personId)).toEqual(['paul', 'pierre', 'jean']);
    const pierre = rows[1];
    expect(pierre?.year).toBe(1857);
    expect(pierre?.alive).toBe(true);
    expect(pierre?.married).toBe(true);
    expect(pierre?.children).toBe(1);
    // Paul has no recorded union: unknown, not "unmarried".
    expect(rows[0]?.married).toBeNull();
  });

  it('stops at someone the reader may not see', () => {
    expect(atAge(graph, 'paul', 30, 'FATHER', (id) => id !== 'pierre')).toHaveLength(1);
  });

  it('says a person had died by that age', () => {
    const rows = atAge(graph, 'louise', 30, 'MOTHER', everyone);
    expect(rows[0]?.alive).toBe(false);
    expect(rows[1]?.personId).toBe('marie');
  });
});

describe('helpers', () => {
  it('takes the median of an even count as the mean of the middle two', () => {
    expect(distribution([1, 2, 3, 10]).median).toBe(2.5);
    expect(distribution([]).median).toBeNull();
  });

  it('returns no distance without coordinates', () => {
    expect(
      haversineKm(
        { label: 'a', latitude: null, longitude: 1 },
        { label: 'b', latitude: 1, longitude: 1 },
      ),
    ).toBeNull();
  });
});
