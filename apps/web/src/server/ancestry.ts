import 'server-only';
import { cache } from 'react';
import { dateToJdn } from '@chronolignee/domain';
import { loadGenealogyGraph } from '@chronolignee/db';
import {
  kinship,
  pedigreeCompleteness,
  sosaNumbers,
  type Kinship,
  type PedigreeCompleteness,
} from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { REDACTED_LABEL, hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';

/**
 * The pedigree, as a researcher reads it.
 *
 * Not a graph dump with generations as a side effect: the Sosa number is the
 * address genealogists actually use to talk to each other, and the empty
 * positions are the point of the view. A pedigree screen that only lists who
 * is known hides the one thing the researcher came to see — where the work
 * stops.
 */

export interface PedigreeSlot {
  /** Sosa-Stradonitz number. Subject 1, father 2n, mother 2n+1. */
  readonly sosa: number;
  readonly generation: number;
  readonly personId: string | null;
  readonly displayName: string;
  readonly lifespanLabel: string;
  readonly redacted: boolean;
  /**
   * True when this person also stands elsewhere in the same pedigree.
   *
   * Pedigree collapse, shown where it happens rather than as a statistic.
   */
  readonly repeated: boolean;
  /** Every Sosa number this person occupies, when there is more than one. */
  readonly alsoAt: readonly number[];
}

export interface PedigreeView {
  readonly access: TreeAccess;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly generations: readonly (readonly PedigreeSlot[])[];
  readonly completeness: readonly PedigreeCompleteness[];
  readonly truncated: boolean;
  /** Distinct people who occupy more than one position. */
  readonly collapsedCount: number;
}

export const DEFAULT_GENERATIONS = 6;

export const loadPedigree = cache(
  async (
    treeSlug: string,
    subjectId: string,
    generations: number = DEFAULT_GENERATIONS,
  ): Promise<PedigreeView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const todayJdn = dateToJdn(new Date());
    const graph = await loadGenealogyGraph(db, access.treeId, todayJdn);
    if (!graph.has(subjectId)) return null;

    const sosa = sosaNumbers(graph, subjectId, { generations });

    // One generation past the last one reached, capped at what was asked for.
    //
    // The whole argument of this screen is that the empty positions are what
    // the researcher came to see. Stopping at the last generation that
    // contains someone would show a pedigree that looks complete at every
    // depth it draws, and never once show the wall the research has hit.
    const lastGeneration = Math.min(generations, sosa.generationsReached + 1);
    const completeness = pedigreeCompleteness(sosa, lastGeneration);
    const isHidden = hiddenInGraph(graph, access);

    let collapsedCount = 0;
    for (const numbers of sosa.numbersById.values()) {
      if (numbers.length > 1) collapsedCount += 1;
    }

    const rows: PedigreeSlot[][] = [];
    for (let generation = 0; generation <= lastGeneration; generation += 1) {
      const first = 2 ** generation;
      const slots: PedigreeSlot[] = [];

      for (let sosaNumber = first; sosaNumber < first * 2; sosaNumber += 1) {
        const personId = sosa.personByNumber.get(sosaNumber) ?? null;
        const person = personId ? graph.people.get(personId) : undefined;
        const isLiving = person?.isDeceased === false;
        const hidden = personId !== null && isHidden(personId);
        const numbers = personId ? (sosa.numbersById.get(personId) ?? []) : [];

        slots.push({
          sosa: sosaNumber,
          generation,
          personId,
          displayName: !person ? '' : hidden ? REDACTED_LABEL : person.displayName,
          // Years go with the name: publishing "1962 –" beside a hidden name
          // still says when that person was born.
          lifespanLabel: !person || hidden ? '' : lifespanLabelOf(person.lifespan, isLiving),
          redacted: hidden,
          repeated: numbers.length > 1,
          alsoAt: numbers.filter((value) => value !== sosaNumber),
        });
      }

      rows.push(slots);
    }

    const subject = graph.people.get(subjectId);

    return {
      access,
      subjectId,
      subjectName: subject?.displayName ?? '',
      generations: rows,
      completeness,
      truncated: sosa.truncated,
      collapsedCount,
    };
  },
);

function lifespanLabelOf(
  lifespan: { earliest: number | null; latest: number | null } | null | undefined,
  isLiving: boolean,
): string {
  if (!lifespan) return '';
  const from = lifespan.earliest === null ? '?' : String(jdnYear(lifespan.earliest));
  if (isLiving) return `${from} –`;
  const to = lifespan.latest === null ? '?' : String(jdnYear(lifespan.latest));
  return `${from} – ${to}`;
}

/** Year of a JDN. The list shows a year, and a year rounds safely. */
function jdnYear(jdn: number): number {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return 100 * b + d - 4800 + Math.floor(m / 10);
}

export interface KinshipView {
  readonly kinship: Kinship;
  /** Names of the shared ancestors, redacted where they must be. */
  readonly throughNames: readonly string[];
  readonly otherName: string;
}

/**
 * How two people in a tree are related.
 *
 * Answered on the server because it needs the whole graph, and because the
 * names of the ancestors it reports through are subject to the same redaction
 * as everything else: "vous êtes cousins par Camille BERTRAND" would name a
 * living person the rest of the product hides.
 */
export async function loadKinship(
  treeSlug: string,
  subjectId: string,
  otherId: string,
): Promise<KinshipView | null> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;

  const todayJdn = dateToJdn(new Date());
  const graph = await loadGenealogyGraph(db, access.treeId, todayJdn);
  if (!graph.has(subjectId) || !graph.has(otherId)) return null;

  const result = kinship(graph, subjectId, otherId);
  const nameOf = (id: string): string => {
    const person = graph.people.get(id);
    if (!person) return '';
    return hiddenInGraph(graph, access)(id) ? REDACTED_LABEL : person.displayName;
  };

  return {
    kinship: result,
    throughNames: result.through.map(nameOf),
    otherName: nameOf(otherId),
  };
}
