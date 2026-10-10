import { jdnToGregorian, wholeYearsBetween, type JdnInterval } from '@chronolignee/domain';
import type { GenealogyGraph, GraphPerson, PersonId } from './graph';

/**
 * Statistics of a recorded tree.
 *
 * Every number here describes the people someone has recorded, not a
 * population: a tree built from one surname line over-represents men, a
 * tree built from parish registers under-represents infants who died
 * unbaptised, and nobody records the cousins they never found. The screen
 * says so, and this module makes it easy to say honestly by counting only
 * what is measurable and returning how many records each figure rests on.
 *
 * Two rules keep the figures from inventing precision:
 *
 *  - An age is measured only between dates known to within about a year
 *    (a window of at most 400 days), midpoint to midpoint. "Born about
 *    1708, died 1771" contributes nothing to the average lifespan; it would
 *    contribute a guess.
 *  - A median, not only a mean: one centenarian in a small tree moves the
 *    mean by years and the median not at all.
 *
 * Pure: the caller decides who is included (a viewer never gets figures
 * about people they may not see) and supplies what the graph does not hold
 * — names, occupations, places.
 */

/** A date good enough to measure an age from. */
const MAX_WINDOW_DAYS = 400;

export interface PlacePoint {
  readonly label: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface StatisticsInput {
  readonly graph: GenealogyGraph;
  readonly include: (personId: PersonId) => boolean;
  /** First given name per person ("Jean" for "Jean-Baptiste Pierre"). */
  readonly givenNames?: ReadonlyMap<PersonId, string>;
  /** Occupations as recorded, one entry per person and occupation. */
  readonly occupations?: ReadonlyArray<{ readonly personId: PersonId; readonly label: string }>;
  readonly birthPlaces?: ReadonlyMap<PersonId, PlacePoint>;
  readonly deathPlaces?: ReadonlyMap<PersonId, PlacePoint>;
}

export interface Distribution {
  /** How many records the figure rests on. */
  readonly count: number;
  readonly median: number | null;
  readonly mean: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

export interface Ranked {
  readonly label: string;
  readonly count: number;
}

export interface TreeStatistics {
  readonly people: number;
  readonly bySex: { readonly female: number; readonly male: number; readonly other: number };
  readonly datedBirths: number;
  readonly datedDeaths: number;
  /** Share of people with at least one dated end of life, 0–1. */
  readonly datedShare: number;
  readonly earliestYear: number | null;
  readonly latestYear: number | null;
  /** The longest line of descent recorded, in generations. */
  readonly generations: number;
  /** Births per decade, split by recorded sex. */
  readonly birthsByDecade: ReadonlyArray<{
    readonly decade: number;
    readonly female: number;
    readonly male: number;
    readonly other: number;
  }>;
  readonly lifespan: Distribution & {
    readonly byCentury: ReadonlyArray<{ readonly century: number } & Distribution>;
    /** Ages at death in ten-year bands: 0–9, 10–19, … */
    readonly bands: ReadonlyArray<{ readonly from: number; readonly count: number }>;
  };
  readonly marriageAge: { readonly female: Distribution; readonly male: Distribution };
  readonly childrenPerCouple: Distribution & {
    readonly bands: ReadonlyArray<{ readonly children: number; readonly couples: number }>;
  };
  readonly givenNames: { readonly female: readonly Ranked[]; readonly male: readonly Ranked[] };
  readonly occupations: readonly Ranked[];
  readonly birthPlaces: readonly Ranked[];
  readonly migration: Distribution & {
    readonly longest: {
      readonly personId: PersonId;
      readonly from: string;
      readonly to: string;
      readonly km: number;
    } | null;
  };
}

// --- Small helpers ----------------------------------------------------------

function precise(interval: JdnInterval | null | undefined): interval is {
  earliest: number;
  latest: number;
} {
  return (
    !!interval &&
    interval.earliest !== null &&
    interval.latest !== null &&
    interval.latest - interval.earliest <= MAX_WINDOW_DAYS
  );
}

const mid = (interval: { earliest: number; latest: number }) =>
  Math.floor((interval.earliest + interval.latest) / 2);

const yearOf = (jdn: number) => jdnToGregorian(jdn).year;

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { count: 0, median: null, mean: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[half] as number)
      : ((sorted[half - 1] as number) + (sorted[half] as number)) / 2;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    median,
    mean: Math.round(mean * 10) / 10,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
  };
}

/**
 * Every step from the first to the last, zero where nothing was recorded. A
 * chart of 0, 30, 50 suggests nobody died in their teens or twenties because
 * the axis left them out, which is a different statement from "none
 * recorded".
 */
function contiguous<T>(
  entries: ReadonlyMap<number, T>,
  step: number,
  empty: () => T,
): Array<[number, T]> {
  const keys = [...entries.keys()];
  if (keys.length === 0) return [];
  const first = Math.min(...keys);
  const last = Math.max(...keys);
  const out: Array<[number, T]> = [];
  for (let key = first; key <= last; key += step) out.push([key, entries.get(key) ?? empty()]);
  return out;
}

function rank(labels: Iterable<string>, limit = 10): Ranked[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    // "Laboureur" and "laboureur" are one occupation; the first spelling wins.
    const key = label.toLocaleLowerCase('fr');
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .slice(0, limit);
}

/** Great-circle distance, in kilometres. */
export function haversineKm(a: PlacePoint, b: PlacePoint): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) {
    return null;
  }
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))));
}

function sexOf(person: GraphPerson): 'female' | 'male' | 'other' {
  return person.recordedSex === 'FEMALE'
    ? 'female'
    : person.recordedSex === 'MALE'
      ? 'male'
      : 'other';
}

/** The person's first own union with a measurable date. */
function firstUnion(person: GraphPerson): { earliest: number; latest: number } | null {
  let first: { earliest: number; latest: number } | null = null;
  for (const event of person.events ?? []) {
    if (event.role !== 'PRINCIPAL' && event.role !== 'SPOUSE') continue;
    if (event.type !== 'MARRIAGE' && event.type !== 'CIVIL_UNION') continue;
    const when = event.date?.interval;
    if (!precise(when)) continue;
    if (!first || when.earliest < first.earliest) first = when;
  }
  return first;
}

// --- The statistics ---------------------------------------------------------

export function treeStatistics(input: StatisticsInput): TreeStatistics {
  const { graph, include } = input;
  const people = [...graph.people.values()].filter((person) => include(person.id));

  const bySex = { female: 0, male: 0, other: 0 };
  let datedBirths = 0;
  let datedDeaths = 0;
  let dated = 0;
  let earliestYear: number | null = null;
  let latestYear: number | null = null;
  const decades = new Map<number, { female: number; male: number; other: number }>();
  const lifespans: Array<{ age: number; century: number }> = [];
  const marriageAges = { female: [] as number[], male: [] as number[] };

  const widen = (year: number) => {
    if (earliestYear === null || year < earliestYear) earliestYear = year;
    if (latestYear === null || year > latestYear) latestYear = year;
  };

  for (const person of people) {
    const sex = sexOf(person);
    bySex[sex] += 1;

    const birth = person.birth?.interval;
    const death = person.death?.interval;
    const hasBirth = !!birth && (birth.earliest !== null || birth.latest !== null);
    const hasDeath = !!death && (death.earliest !== null || death.latest !== null);
    if (hasBirth) datedBirths += 1;
    if (hasDeath) datedDeaths += 1;
    if (hasBirth || hasDeath) dated += 1;

    for (const edge of [birth, death]) {
      const point = edge?.earliest ?? edge?.latest;
      if (point !== null && point !== undefined) widen(yearOf(point));
    }

    if (precise(birth)) {
      const decade = Math.floor(yearOf(mid(birth)) / 10) * 10;
      const bucket = decades.get(decade) ?? { female: 0, male: 0, other: 0 };
      bucket[sex] += 1;
      decades.set(decade, bucket);

      if (precise(death) && death.earliest >= birth.earliest) {
        lifespans.push({
          age: wholeYearsBetween(mid(birth), mid(death)),
          century: Math.floor(yearOf(mid(birth)) / 100) + 1,
        });
      }

      const union = firstUnion(person);
      if (union && sex !== 'other') {
        const age = wholeYearsBetween(mid(birth), mid(union));
        if (age >= 0) marriageAges[sex].push(age);
      }
    }
  }

  // --- Generations: the longest recorded line, cycles guarded ------------
  const depth = new Map<PersonId, number>();
  const visiting = new Set<PersonId>();
  const generationsOf = (id: PersonId): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // a cycle: the audit reports it.
    visiting.add(id);
    let best = 0;
    for (const edge of graph.parentsOf(id)) {
      if (include(edge.sourceId)) best = Math.max(best, generationsOf(edge.sourceId));
    }
    visiting.delete(id);
    depth.set(id, best + 1);
    return best + 1;
  };
  let generations = 0;
  for (const person of people) generations = Math.max(generations, generationsOf(person.id));

  // --- Children per couple -------------------------------------------------
  const couples = new Map<string, number>();
  for (const person of people) {
    const parents = [
      ...new Set(
        graph
          .parentsOf(person.id, true)
          .map((edge) => edge.sourceId)
          .filter(include),
      ),
    ].sort();
    if (parents.length !== 2) continue;
    const key = parents.join('|');
    couples.set(key, (couples.get(key) ?? 0) + 1);
  }
  const familySizes = [...couples.values()];
  const sizeBands = new Map<number, number>();
  for (const size of familySizes) sizeBands.set(size, (sizeBands.get(size) ?? 0) + 1);

  // --- Lifespan bands and centuries ---------------------------------------
  const ages = lifespans.map((entry) => entry.age);
  const bands = new Map<number, number>();
  for (const age of ages) {
    const from = Math.min(Math.floor(age / 10) * 10, 100);
    bands.set(from, (bands.get(from) ?? 0) + 1);
  }
  const centuries = new Map<number, number[]>();
  for (const entry of lifespans) {
    const list = centuries.get(entry.century) ?? [];
    list.push(entry.age);
    centuries.set(entry.century, list);
  }

  // --- Names, occupations, places -----------------------------------------
  const givenFemale: string[] = [];
  const givenMale: string[] = [];
  for (const person of people) {
    const given = input.givenNames?.get(person.id);
    if (!given) continue;
    if (person.recordedSex === 'FEMALE') givenFemale.push(given);
    else if (person.recordedSex === 'MALE') givenMale.push(given);
  }

  const distances: number[] = [];
  let longest: TreeStatistics['migration']['longest'] = null;
  for (const person of people) {
    const from = input.birthPlaces?.get(person.id);
    const to = input.deathPlaces?.get(person.id);
    if (!from || !to) continue;
    const km = haversineKm(from, to);
    if (km === null) continue;
    distances.push(km);
    if (!longest || km > longest.km) {
      longest = { personId: person.id, from: from.label, to: to.label, km };
    }
  }

  return {
    people: people.length,
    bySex,
    datedBirths,
    datedDeaths,
    datedShare: people.length === 0 ? 0 : dated / people.length,
    earliestYear,
    latestYear,
    generations,
    birthsByDecade: contiguous(decades, 10, () => ({ female: 0, male: 0, other: 0 })).map(
      ([decade, counts]) => ({ decade, ...counts }),
    ),
    lifespan: {
      ...distribution(ages),
      byCentury: [...centuries.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([century, list]) => ({ century, ...distribution(list) })),
      bands: contiguous(new Map([[0, 0], ...bands]), 10, () => 0).map(([from, count]) => ({
        from,
        count,
      })),
    },
    marriageAge: {
      female: distribution(marriageAges.female),
      male: distribution(marriageAges.male),
    },
    childrenPerCouple: {
      ...distribution(familySizes),
      bands: contiguous(new Map([[1, 0], ...sizeBands]), 1, () => 0).map(([children, count]) => ({
        children,
        couples: count,
      })),
    },
    givenNames: { female: rank(givenFemale), male: rank(givenMale) },
    occupations: rank(
      (input.occupations ?? []).filter((o) => include(o.personId)).map((o) => o.label),
    ),
    birthPlaces: rank(
      people.flatMap((person) => {
        const place = input.birthPlaces?.get(person.id);
        return place ? [place.label] : [];
      }),
    ),
    migration: { ...distribution(distances), longest },
  };
}

// --- "At age X" -------------------------------------------------------------

export interface AtAgeRow {
  readonly personId: PersonId;
  readonly name: string;
  /** 0 for the person chosen, 1 for their parent on that line, 2 for the grandparent… */
  readonly generation: number;
  /** The year they turned that age, when the birth is known well enough. */
  readonly year: number | null;
  /** Alive on that birthday: true, false, or null when the dates cannot say. */
  readonly alive: boolean | null;
  readonly married: boolean | null;
  /** Children recorded as born before that birthday. */
  readonly children: number;
}

/**
 * The same age, a generation apart.
 *
 * Follow one line up from a person — father's father's father, or mother's
 * mother's mother — and ask of each the same question: at thirty, what year
 * was it, were they alive, married, how many children had they had? It is the
 * comparison families actually make ("at my age, grandfather already had five
 * children"), answered only from what is recorded.
 */
export function atAge(
  graph: GenealogyGraph,
  personId: PersonId,
  age: number,
  line: 'FATHER' | 'MOTHER',
  include: (personId: PersonId) => boolean,
  maxGenerations = 8,
): AtAgeRow[] {
  const rows: AtAgeRow[] = [];
  let current: PersonId | undefined = personId;
  const seen = new Set<PersonId>();

  for (let generation = 0; current && generation <= maxGenerations; generation += 1) {
    if (seen.has(current) || !include(current)) break;
    seen.add(current);
    const person = graph.people.get(current);
    if (!person) break;

    const birth = person.birth?.interval;
    const at = precise(birth) ? mid(birth) + Math.round(age * 365.2425) : null;
    const death = person.death?.interval;

    let alive: boolean | null = null;
    if (at !== null) {
      if (death?.latest !== null && death?.latest !== undefined && death.latest < at) alive = false;
      else if (death?.earliest !== null && death?.earliest !== undefined && death.earliest > at) {
        alive = true;
      } else if (!death || (death.earliest === null && death.latest === null)) {
        alive = person.isDeceased === false ? true : null;
      }
    }

    const union = firstUnion(person);
    // No recorded union is not "unmarried": it is a record not yet found.
    const married = at === null || !union ? null : union.latest <= at;

    let children = 0;
    if (at !== null) {
      for (const edge of graph.childrenOf(current)) {
        const childBirth = graph.people.get(edge.targetId)?.birth?.interval;
        if (include(edge.targetId) && childBirth?.latest != null && childBirth.latest <= at) {
          children += 1;
        }
      }
    }

    rows.push({
      personId: current,
      name: person.displayName,
      generation,
      year: at === null ? null : yearOf(at),
      alive,
      married,
      children,
    });

    const wanted = line === 'FATHER' ? 'MALE' : 'FEMALE';
    current = graph
      .parentsOf(current, true)
      .map((edge) => edge.sourceId)
      .find((id) => graph.people.get(id)?.recordedSex === wanted);
  }

  return rows;
}
