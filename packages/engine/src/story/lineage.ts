/**
 * "Remonter ma lignée": a story plan climbing one line, generation by
 * generation, into the past.
 *
 * A plan is a list of scenes that refer to the record — people, places,
 * historical events — and never a text. What a scene says is decided later,
 * from the same record, by code that can be read and tested; nothing here
 * writes a sentence, so nothing here can invent one.
 *
 * Every scene rests on data that is actually there. An age is given only
 * when both births are known, and as a range when either is uncertain. A
 * historical event is attached to someone only when their birth and death
 * both bracket it — "he was 64 when the war began" is true only of a man who
 * was alive, and an unknown death does not say he was. A wave of emigration
 * is context only for someone the record shows moving: set beside a woman
 * who lived and died in Tours, it would suggest a link nobody recorded. A
 * move is shown only between two places whose coordinates were recorded.
 */

export type LineChoice = 'paternal' | 'maternal' | 'oldest';

export interface StoryDate {
  /** As a reader should see it: "12 juin 1822", "vers 1750". */
  readonly label: string;
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
}

export interface StoryPlace {
  readonly id: string;
  readonly name: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface StorySource {
  readonly title: string;
  readonly locator: string | null;
}

export interface StoryFact {
  readonly date: StoryDate | null;
  readonly place: StoryPlace | null;
  readonly sources: readonly StorySource[];
}

export interface StoryOccupation {
  readonly label: string;
  readonly date: StoryDate | null;
  readonly sources: readonly StorySource[];
}

export interface StoryPerson {
  readonly id: string;
  readonly name: string;
  readonly recordedSex: 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN' | null;
  /** May not be shown to this viewer: the ascent stops before them. */
  readonly hidden: boolean;
  readonly birth: StoryFact | null;
  readonly death: StoryFact | null;
  readonly occupations: readonly StoryOccupation[];
  readonly fatherId: string | null;
  readonly motherId: string | null;
  /** A migration or a naturalisation is recorded for this person. */
  readonly migrated: boolean;
}

export interface StoryHistoricalEvent {
  readonly id: string;
  readonly title: string;
  readonly startJdn: number;
  readonly endJdn: number;
  /** 1 to 5. */
  readonly significance: number;
  /** WAR, POLITICAL, MIGRATION… as the historical layer records it. */
  readonly category: string;
}

/** Whole years, as a range when the dates behind them are ranges. */
export interface AgeRange {
  readonly min: number;
  readonly max: number;
}

export type StoryScene =
  | { readonly kind: 'person-focus'; readonly personId: string }
  | {
      readonly kind: 'ancestor-step';
      readonly childId: string;
      readonly parentId: string;
      readonly relation: 'father' | 'mother';
      /** 1 for a parent of the subject, 2 for a grandparent, and so on. */
      readonly generation: number;
      readonly ageAtChildBirth: AgeRange | null;
    }
  | {
      readonly kind: 'migration';
      readonly childId: string;
      readonly parentId: string;
      /** The parent's birthplace. */
      readonly from: StoryPlace;
      /** The child's birthplace. */
      readonly to: StoryPlace;
      readonly distanceKm: number;
    }
  | {
      readonly kind: 'historical-context';
      readonly personId: string;
      readonly eventId: string;
      readonly age: AgeRange;
    }
  | {
      readonly kind: 'end';
      /** The last person reached. */
      readonly personId: string;
      readonly reason: 'unknown-parent' | 'protected' | 'limit';
      /** The parent the line would have followed, for "father" or "mother". */
      readonly missing: 'father' | 'mother' | 'parent';
    };

export interface StoryPlan {
  readonly subjectId: string;
  readonly line: LineChoice;
  readonly scenes: readonly StoryScene[];
  /** How many generations above the subject the line reached. */
  readonly generations: number;
}

export interface LineageOptions {
  readonly maxGenerations?: number;
  /** A move shorter than this is a neighbouring parish, not a migration. */
  readonly minMigrationKm?: number;
}

const DAYS_PER_YEAR = 365.2425;
const DEFAULT_MAX_GENERATIONS = 16;
const DEFAULT_MIN_MIGRATION_KM = 25;

export function planLineageAscent(
  subjectId: string,
  people: ReadonlyMap<string, StoryPerson>,
  historical: readonly StoryHistoricalEvent[],
  line: LineChoice,
  options: LineageOptions = {},
): StoryPlan | null {
  const subject = people.get(subjectId);
  if (!subject || subject.hidden) return null;

  const maxGenerations = options.maxGenerations ?? DEFAULT_MAX_GENERATIONS;
  const minMigrationKm = options.minMigrationKm ?? DEFAULT_MIN_MIGRATION_KM;
  const usedEvents = new Set<string>();
  const scenes: StoryScene[] = [{ kind: 'person-focus', personId: subjectId }];
  pushHistory(scenes, subject, historical, usedEvents);

  const oldestCache = new Map<string, number>();
  let child = subject;
  let generation = 0;

  for (;;) {
    const next = chooseParent(child, line, people, oldestCache);
    if (next === null) {
      scenes.push({
        kind: 'end',
        personId: child.id,
        reason: 'unknown-parent',
        missing: line === 'paternal' ? 'father' : line === 'maternal' ? 'mother' : 'parent',
      });
      break;
    }
    const parent = people.get(next.id);
    if (!parent || parent.hidden) {
      scenes.push({ kind: 'end', personId: child.id, reason: 'protected', missing: next.relation });
      break;
    }
    if (generation >= maxGenerations) {
      scenes.push({ kind: 'end', personId: child.id, reason: 'limit', missing: next.relation });
      break;
    }

    generation += 1;
    const childBirth = child.birth?.date;
    scenes.push({
      kind: 'ancestor-step',
      childId: child.id,
      parentId: parent.id,
      relation: next.relation,
      generation,
      ageAtChildBirth:
        parent.birth?.date && childBirth
          ? ageBetween(parent.birth.date, childBirth.earliestJdn, childBirth.latestJdn)
          : null,
    });

    const from = parent.birth?.place;
    const to = child.birth?.place;
    if (from && to && from.id !== to.id) {
      const distance = distanceKm(from, to);
      if (distance !== null && distance >= minMigrationKm) {
        scenes.push({
          kind: 'migration',
          childId: child.id,
          parentId: parent.id,
          from,
          to,
          distanceKm: Math.round(distance),
        });
      }
    }

    pushHistory(scenes, parent, historical, usedEvents);
    child = parent;
  }

  return { subjectId, line, scenes, generations: generation };
}

function chooseParent(
  child: StoryPerson,
  line: LineChoice,
  people: ReadonlyMap<string, StoryPerson>,
  oldestCache: Map<string, number>,
): { id: string; relation: 'father' | 'mother' } | null {
  if (line === 'paternal')
    return child.fatherId ? { id: child.fatherId, relation: 'father' } : null;
  if (line === 'maternal')
    return child.motherId ? { id: child.motherId, relation: 'mother' } : null;

  // The oldest line: whichever parent leads to the earliest recorded birth.
  // The father on a tie, as Sosa numbering puts him first.
  const candidates: { id: string; relation: 'father' | 'mother' }[] = [];
  if (child.fatherId) candidates.push({ id: child.fatherId, relation: 'father' });
  if (child.motherId) candidates.push({ id: child.motherId, relation: 'mother' });
  let best: { id: string; relation: 'father' | 'mother'; reach: number } | null = null;
  for (const candidate of candidates) {
    const reach = oldestReachable(candidate.id, people, oldestCache, new Set());
    if (best === null || reach < best.reach) best = { ...candidate, reach };
  }
  return best ? { id: best.id, relation: best.relation } : null;
}

/**
 * The earliest birth reachable by climbing from this person, among people the
 * viewer may see. A hidden person ends a line: the oldest line must not route
 * around the redaction by counting what lies beyond it.
 */
function oldestReachable(
  id: string,
  people: ReadonlyMap<string, StoryPerson>,
  cache: Map<string, number>,
  visiting: Set<string>,
): number {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const person = people.get(id);
  if (!person || person.hidden || visiting.has(id)) return Number.POSITIVE_INFINITY;

  visiting.add(id);
  let earliest = person.birth?.date?.earliestJdn ?? person.birth?.date?.latestJdn ?? Infinity;
  for (const parentId of [person.fatherId, person.motherId]) {
    if (parentId) earliest = Math.min(earliest, oldestReachable(parentId, people, cache, visiting));
  }
  visiting.delete(id);
  cache.set(id, earliest);
  return earliest;
}

function pushHistory(
  scenes: StoryScene[],
  person: StoryPerson,
  historical: readonly StoryHistoricalEvent[],
  used: Set<string>,
): void {
  const birth = person.birth?.date;
  const death = person.death?.date;
  if (!birth || birth.latestJdn === null || !death || death.earliestJdn === null) return;
  const bornBy = birth.latestJdn;
  const aliveUntil = death.earliestJdn;

  const candidates = historical
    .filter(
      (event) =>
        !used.has(event.id) &&
        event.startJdn > bornBy &&
        event.startJdn < aliveUntil &&
        (event.category !== 'MIGRATION' || person.migrated),
    )
    .sort((a, b) => b.significance - a.significance || a.startJdn - b.startJdn);
  const chosen = candidates[0];
  if (!chosen) return;
  const age = ageBetween(birth, chosen.startJdn, chosen.startJdn);
  if (!age) return;
  used.add(chosen.id);
  scenes.push({ kind: 'historical-context', personId: person.id, eventId: chosen.id, age });
}

/** Completed years between a birth and a moment, as a range over both uncertainties. */
export function ageBetween(
  birth: StoryDate,
  atEarliestJdn: number | null,
  atLatestJdn: number | null,
): AgeRange | null {
  if (
    birth.earliestJdn === null ||
    birth.latestJdn === null ||
    atEarliestJdn === null ||
    atLatestJdn === null
  ) {
    return null;
  }
  const min = Math.floor((atEarliestJdn - birth.latestJdn) / DAYS_PER_YEAR);
  const max = Math.floor((atLatestJdn - birth.earliestJdn) / DAYS_PER_YEAR);
  if (max < 0) return null;
  return { min: Math.max(0, min), max };
}

/** Great-circle distance, or null when either place has no coordinates. */
export function distanceKm(a: StoryPlace, b: StoryPlace): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) {
    return null;
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
