import 'server-only';
import { cache } from 'react';
import { dateToJdn } from '@chronolignee/domain';
import {
  atAge,
  treeStatistics,
  type AtAgeRow,
  type PlacePoint,
  type TreeStatistics,
} from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';
import { treeGraph } from './graph-cache';

/**
 * The figures of one tree, computed for one reader.
 *
 * Open to whoever may read the tree, like the timeline — and computed only
 * over the people this reader may see. A count of births per decade that
 * included protected relatives would let anyone subtract the public ones and
 * recover how many living cousins there are, and roughly when they were born.
 */

export interface TreeFigures {
  readonly access: TreeAccess;
  readonly statistics: TreeStatistics;
  /** People with a known father or mother, for the "at age X" chooser. */
  readonly lineageStarts: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export const loadTreeFigures = cache(async (treeSlug: string): Promise<TreeFigures | null> => {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;

  const todayJdn = dateToJdn(new Date());
  const graph = await treeGraph(access.treeId, todayJdn);
  const hidden = hiddenInGraph(graph, access);
  const include = (personId: string) => graph.people.has(personId) && !hidden(personId);

  const [names, occupationEvents, occupationClaims, vitalPlaces] = await Promise.all([
    db.personName.findMany({
      where: { treeId: access.treeId, isPreferred: true, person: { deletedAt: null } },
      select: { personId: true, given: true },
    }),
    db.event.findMany({
      where: {
        treeId: access.treeId,
        deletedAt: null,
        type: 'OCCUPATION',
        description: { not: null },
      },
      select: {
        description: true,
        participants: { where: { role: 'PRINCIPAL' }, select: { personId: true } },
      },
    }),
    db.claim.findMany({
      where: {
        treeId: access.treeId,
        status: 'ACCEPTED',
        predicate: 'OCCUPATION',
        personId: { not: null },
      },
      select: { personId: true, valueText: true },
    }),
    db.event.findMany({
      where: {
        treeId: access.treeId,
        deletedAt: null,
        type: { in: ['BIRTH', 'BAPTISM', 'DEATH', 'BURIAL'] },
        placeId: { not: null },
      },
      select: {
        type: true,
        place: { select: { name: true, historicalName: true, latitude: true, longitude: true } },
        participants: { where: { role: 'PRINCIPAL' }, select: { personId: true } },
      },
    }),
  ]);

  const givenNames = new Map<string, string>();
  for (const name of names) {
    // The first given name: "Jean-Baptiste Pierre" counts as Jean-Baptiste,
    // the name the person was called by in the register.
    const first = name.given?.trim().split(/\s+/)[0];
    if (first && !givenNames.has(name.personId)) givenNames.set(name.personId, first);
  }

  const occupations: Array<{ personId: string; label: string }> = [];
  const seenOccupation = new Set<string>();
  const addOccupation = (personId: string, label: string) => {
    const key = `${personId}|${label.trim().toLocaleLowerCase('fr')}`;
    if (seenOccupation.has(key)) return;
    seenOccupation.add(key);
    occupations.push({ personId, label: label.trim() });
  };
  for (const event of occupationEvents) {
    for (const participant of event.participants) {
      if (event.description) addOccupation(participant.personId, event.description);
    }
  }
  for (const claim of occupationClaims) {
    if (claim.personId && claim.valueText) addOccupation(claim.personId, claim.valueText);
  }

  // Birth place, falling back to the baptism; death place to the burial.
  const birthPlaces = new Map<string, PlacePoint>();
  const deathPlaces = new Map<string, PlacePoint>();
  const order = { BIRTH: 0, BAPTISM: 1, DEATH: 0, BURIAL: 1 } as const;
  const rankOf = new Map<string, number>();
  for (const event of vitalPlaces) {
    if (!event.place) continue;
    const point: PlacePoint = {
      label: event.place.historicalName ?? event.place.name,
      latitude: event.place.latitude,
      longitude: event.place.longitude,
    };
    const birthSide = event.type === 'BIRTH' || event.type === 'BAPTISM';
    const target = birthSide ? birthPlaces : deathPlaces;
    const rank = order[event.type as keyof typeof order];
    for (const participant of event.participants) {
      const key = `${birthSide ? 'b' : 'd'}|${participant.personId}`;
      if ((rankOf.get(key) ?? Number.POSITIVE_INFINITY) <= rank) continue;
      rankOf.set(key, rank);
      target.set(participant.personId, point);
    }
  }

  const statistics = treeStatistics({
    graph,
    include,
    givenNames,
    occupations,
    birthPlaces,
    deathPlaces,
  });

  const lineageStarts = [...graph.people.values()]
    .filter((person) => include(person.id) && graph.parentsOf(person.id, true).length > 0)
    .map((person) => ({ id: person.id, name: person.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return { access, statistics, lineageStarts };
});

/** "At age X" for one person and one line, or null when they may not be read. */
export async function loadAtAge(
  treeSlug: string,
  personId: string,
  age: number,
  line: 'FATHER' | 'MOTHER',
): Promise<readonly AtAgeRow[] | null> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;
  const graph = await treeGraph(access.treeId, dateToJdn(new Date()));
  const hidden = hiddenInGraph(graph, access);
  const include = (id: string) => graph.people.has(id) && !hidden(id);
  if (!include(personId)) return null;
  return atAge(graph, personId, age, line, include);
}
