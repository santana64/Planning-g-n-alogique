/**
 * The Director: what in the record is worth telling.
 *
 * It reads only accepted data, finds patterns a reader would care about, and
 * turns each into a story plan for the same planner and the same renderer as
 * "Remonter la lignée". It decides what to present; how it is presented, and
 * every word of it, stays with code that reads the record. There is no text
 * here, only facts — a distance, a count, two years — for the caller to put
 * into words.
 *
 * Every pattern rests on data that is there, with the same strictness as the
 * planner: a move needs two geolocated birthplaces; four generations "alive at
 * the same time" needs four known deaths, because an unknown death is not
 * evidence of a long life. Nobody the viewer may not see is part of a pattern.
 */

import { jdnToGregorian } from '@chronolignee/domain';
import {
  distanceKm,
  planLineageAscent,
  type StoryHistoricalEvent,
  type StoryPerson,
  type StoryPlan,
} from './lineage';

export type StoryCandidateFacts =
  | {
      readonly kind: 'migration';
      readonly parentId: string;
      readonly childId: string;
      readonly from: string;
      readonly to: string;
      readonly distanceKm: number;
    }
  | {
      readonly kind: 'deep-line';
      readonly generations: number;
      /** The earliest birth year the line reaches. */
      readonly earliestYear: number | null;
    }
  | { readonly kind: 'well-documented'; readonly events: number; readonly cited: number }
  | {
      readonly kind: 'four-generations';
      /** Youngest first. */
      readonly personIds: readonly [string, string, string, string];
      /** Whole years during which all four were certainly alive. */
      readonly fromYear: number;
      readonly toYear: number;
    };

export interface StoryCandidate {
  /** Stable across requests, so a selection can refer to it. */
  readonly id: string;
  readonly subjectId: string;
  readonly facts: StoryCandidateFacts;
  /** How strongly the rules recommend it; only used to rank. */
  readonly score: number;
  readonly plan: StoryPlan;
}

export interface DirectorInput {
  readonly people: ReadonlyMap<string, StoryPerson>;
  readonly coverage: ReadonlyMap<string, { readonly events: number; readonly cited: number }>;
  readonly historical: readonly StoryHistoricalEvent[];
}

/** A move this long is a migration worth a story, not a change of parish. */
const STORY_MIGRATION_KM = 300;
const MIN_DOCUMENTED_EVENTS = 3;

function yearOfJdn(jdn: number): number {
  return jdnToGregorian(jdn).year;
}

function visible(people: ReadonlyMap<string, StoryPerson>, id: string | null): StoryPerson | null {
  if (!id) return null;
  const person = people.get(id);
  return person && !person.hidden ? person : null;
}

export function findStoryCandidates(input: DirectorInput): StoryCandidate[] {
  const { people, coverage, historical } = input;
  const candidates: StoryCandidate[] = [];
  const hasChildren = new Set<string>();
  for (const person of people.values()) {
    if (person.fatherId) hasChildren.add(person.fatherId);
    if (person.motherId) hasChildren.add(person.motherId);
  }

  // Migrations: the longest move between a parent's birth and a child's.
  const bestMove = new Map<string, StoryCandidate>();
  for (const child of people.values()) {
    if (child.hidden || !child.birth?.place) continue;
    for (const relation of ['father', 'mother'] as const) {
      const parent = visible(people, relation === 'father' ? child.fatherId : child.motherId);
      if (!parent?.birth?.place) continue;
      const distance = distanceKm(parent.birth.place, child.birth.place);
      if (distance === null || distance < STORY_MIGRATION_KM) continue;
      const candidate: StoryCandidate = {
        id: `migration:${child.id}:${parent.id}`,
        subjectId: child.id,
        facts: {
          kind: 'migration',
          parentId: parent.id,
          childId: child.id,
          from: parent.birth.place.name,
          to: child.birth.place.name,
          distanceKm: Math.round(distance),
        },
        score: 2 + Math.min(3, distance / 2000),
        plan: planLineageAscent(child.id, people, historical, 'oldest', {
          maxGenerations: 3,
          path: [relation],
        }) as StoryPlan,
      };
      const key = `${parent.birth.place.id}>${child.birth.place.id}`;
      const existing = bestMove.get(key);
      // One story per route: the first family to make the move, in birth order.
      if (
        !existing ||
        (child.birth.date?.earliestJdn ?? Infinity) < birthOf(people, existing.subjectId)
      ) {
        bestMove.set(key, candidate);
      }
    }
  }
  candidates.push(...bestMove.values());

  // The deepest line: from the end of a line, the furthest back it goes.
  let deepest: StoryCandidate | null = null;
  for (const person of people.values()) {
    if (person.hidden || hasChildren.has(person.id)) continue;
    const plan = planLineageAscent(person.id, people, historical, 'oldest');
    if (!plan || plan.generations < 3) continue;
    const earliest = plan.scenes.reduce<number | null>((min, scene) => {
      if (scene.kind !== 'ancestor-step') return min;
      const jdn = people.get(scene.parentId)?.birth?.date?.earliestJdn ?? null;
      return jdn === null ? min : min === null ? jdn : Math.min(min, jdn);
    }, null);
    const candidate: StoryCandidate = {
      id: `deep-line:${person.id}`,
      subjectId: person.id,
      facts: {
        kind: 'deep-line',
        generations: plan.generations,
        earliestYear: earliest === null ? null : yearOfJdn(earliest),
      },
      score: 1.5 + plan.generations / 4,
      plan,
    };
    if (
      !deepest ||
      candidate.score > deepest.score ||
      (candidate.score === deepest.score && candidate.id < deepest.id)
    ) {
      deepest = candidate;
    }
  }
  if (deepest) candidates.push(deepest);

  // The best-documented life: most of its events sourced, and enough of them.
  let documented: StoryCandidate | null = null;
  for (const [id, counts] of coverage) {
    const person = visible(people, id);
    if (!person || counts.events < MIN_DOCUMENTED_EVENTS || counts.cited === 0) continue;
    const ratio = counts.cited / counts.events;
    const plan = planLineageAscent(id, people, historical, 'oldest', { maxGenerations: 2 });
    if (!plan) continue;
    const candidate: StoryCandidate = {
      id: `well-documented:${id}`,
      subjectId: id,
      facts: { kind: 'well-documented', events: counts.events, cited: counts.cited },
      score: 1 + ratio * 2 * Math.min(1, counts.events / 6),
      plan,
    };
    if (
      !documented ||
      candidate.score > documented.score ||
      (candidate.score === documented.score && candidate.id < documented.id)
    ) {
      documented = candidate;
    }
  }
  if (documented) candidates.push(documented);

  // Four generations certainly alive at once.
  let overlap: StoryCandidate | null = null;
  for (const youngest of people.values()) {
    if (youngest.hidden) continue;
    for (const path of PATHS) {
      const chain = [youngest];
      let current: StoryPerson | null = youngest;
      for (const step of path) {
        current = visible(people, step === 'father' ? current.fatherId : current.motherId);
        if (!current) break;
        chain.push(current);
      }
      if (chain.length !== 4) continue;
      const window = certainOverlap(chain);
      if (!window) continue;
      const [a, b, c, d] = chain as [StoryPerson, StoryPerson, StoryPerson, StoryPerson];
      const candidate: StoryCandidate = {
        id: `four-generations:${a.id}:${path.join('-')}`,
        subjectId: a.id,
        facts: {
          kind: 'four-generations',
          personIds: [a.id, b.id, c.id, d.id],
          fromYear: window.fromYear,
          toYear: window.toYear,
        },
        score: 2 + Math.min(2, (window.toYear - window.fromYear) / 20),
        plan: planLineageAscent(a.id, people, historical, 'oldest', {
          maxGenerations: 3,
          path,
        }) as StoryPlan,
      };
      if (
        !overlap ||
        candidate.score > overlap.score ||
        (candidate.score === overlap.score && candidate.id < overlap.id)
      ) {
        overlap = candidate;
      }
    }
  }
  if (overlap) candidates.push(overlap);

  return candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

const PATHS: readonly (readonly ('father' | 'mother')[])[] = [
  ['father', 'father', 'father'],
  ['father', 'father', 'mother'],
  ['father', 'mother', 'father'],
  ['father', 'mother', 'mother'],
  ['mother', 'father', 'father'],
  ['mother', 'father', 'mother'],
  ['mother', 'mother', 'father'],
  ['mother', 'mother', 'mother'],
];

function birthOf(people: ReadonlyMap<string, StoryPerson>, id: string): number {
  return people.get(id)?.birth?.date?.earliestJdn ?? Infinity;
}

/**
 * The years during which everyone in the chain was certainly alive: after
 * the latest possible birth of the youngest, before the earliest possible
 * death of whoever died first. Null unless every death is known.
 */
function certainOverlap(
  chain: readonly StoryPerson[],
): { fromYear: number; toYear: number } | null {
  let from = -Infinity;
  let to = Infinity;
  for (const person of chain) {
    const born = person.birth?.date?.latestJdn ?? null;
    const died = person.death?.date?.earliestJdn ?? null;
    if (born === null || died === null) return null;
    from = Math.max(from, born);
    to = Math.min(to, died);
  }
  if (!(to > from)) return null;
  const fromYear = yearOfJdn(from);
  const toYear = yearOfJdn(to);
  return toYear > fromYear ? { fromYear, toYear } : null;
}

/**
 * The rules' choice: the strongest candidates, one per person, so a family
 * with one well-travelled branch is not told four times through it.
 */
export function chooseStoriesByRules(
  candidates: readonly StoryCandidate[],
  limit = 4,
): StoryCandidate[] {
  const chosen: StoryCandidate[] = [];
  const subjects = new Set<string>();
  for (const candidate of [...candidates].sort(
    (a, b) => b.score - a.score || (a.id < b.id ? -1 : 1),
  )) {
    if (chosen.length >= limit) break;
    if (subjects.has(candidate.subjectId)) continue;
    subjects.add(candidate.subjectId);
    chosen.push(candidate);
  }
  return chosen;
}
