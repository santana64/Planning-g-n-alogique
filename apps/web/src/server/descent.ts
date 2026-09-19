import 'server-only';
import { cache } from 'react';
import { dateToJdn } from '@chronolignee/domain';
import { abovilleNumbers } from '@chronolignee/genealogy';
import { treeGraph } from './graph-cache';
import { REDACTED_LABEL, hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';

/**
 * A descendant study.
 *
 * The mirror of the pedigree and a different kind of document: an ascendancy
 * is a search that narrows, a descent is a census that widens. It is read as
 * an indented list, so the rows arrive already in that order rather than as a
 * tree the client has to flatten.
 */

export interface DescentRow {
  readonly personId: string;
  /** D'Aboville number: "1", "1.1", "1.2.1". */
  readonly number: string;
  readonly generation: number;
  readonly displayName: string;
  readonly lifespanLabel: string;
  readonly redacted: boolean;
  /** True when this person's position among siblings was not recorded. */
  readonly orderInferred: boolean;
  /** True when they descend from the subject by more than one line. */
  readonly repeated: boolean;
}

export interface DescentView {
  readonly access: TreeAccess;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly rows: readonly DescentRow[];
  /** Distinct people per generation, subject first. */
  readonly perGeneration: readonly number[];
  readonly totalPeople: number;
  readonly truncated: boolean;
}

export const DEFAULT_DESCENT_GENERATIONS = 5;

export const loadDescent = cache(
  async (
    treeSlug: string,
    subjectId: string,
    generations: number = DEFAULT_DESCENT_GENERATIONS,
  ): Promise<DescentView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const todayJdn = dateToJdn(new Date());
    const graph = await treeGraph(access.treeId, todayJdn);
    if (!graph.has(subjectId)) return null;

    const descent = abovilleNumbers(graph, subjectId, { generations });
    const isHidden = hiddenInGraph(graph, access);

    const rows = descent.nodes.map((node): DescentRow => {
      const person = graph.people.get(node.personId);
      const isLiving = person?.isDeceased === false;
      const hidden = isHidden(node.personId);
      const numbers = descent.numbersById.get(node.personId) ?? [];

      return {
        personId: node.personId,
        number: node.number,
        generation: node.generation,
        displayName: hidden ? REDACTED_LABEL : (person?.displayName ?? ''),
        // A descendant study reaches the living by construction — it is the
        // one view where most of the last two generations are alive. Years go
        // with the name or the redaction is decorative.
        lifespanLabel: hidden ? '' : lifespanLabelOf(person?.lifespan, isLiving),
        redacted: hidden,
        orderInferred: node.orderInferred,
        repeated: numbers.length > 1,
      };
    });

    return {
      access,
      subjectId,
      subjectName: graph.people.get(subjectId)?.displayName ?? '',
      rows,
      perGeneration: descent.perGeneration,
      // People, not rows: someone who descends by two lines is one person.
      totalPeople: descent.numbersById.size,
      truncated: descent.truncated,
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

function jdnYear(jdn: number): number {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return 100 * b + d - 4800 + Math.floor(m / 10);
}
