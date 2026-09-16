import { isBiologicalParentType, type GenealogyGraph, type PersonId } from './graph';

/**
 * Descent, numbered the way French genealogy numbers it.
 *
 * D'Aboville: the subject is "1", their children "1.1", "1.2", "1.3" in birth
 * order, and so on down. Unlike Sosa it encodes position among siblings, which
 * is why it is the numbering used for a descendant study and why it is
 * sensitive to something Sosa never has to care about — a child with no
 * recorded birth date.
 */

export interface DescentOptions {
  /** Generations below the subject. The subject is generation 0. */
  readonly generations?: number;
  /**
   * Whether to follow only biological parentage.
   *
   * Defaults to false, the opposite of Sosa. A descendant study is about a
   * family and its households; an adopted child belongs in it. Sosa encodes
   * descent, and these two numberings answer genuinely different questions.
   */
  readonly biologicalOnly?: boolean;
}

export interface DescentNode {
  readonly personId: PersonId;
  /** D'Aboville number, e.g. "1.2.1". */
  readonly number: string;
  readonly generation: number;
  /** The parent's number, or null for the subject. */
  readonly parentNumber: string | null;
  /**
   * True when this person's position among their siblings was not recorded.
   *
   * D'Aboville numbers birth order, so a child with no date has no defensible
   * position. They are placed after the dated ones and flagged, rather than
   * being silently interleaved as though the order were known.
   */
  readonly orderInferred: boolean;
}

export interface DescentResult {
  /** Depth-first, so a reader can print it as an indented list unchanged. */
  readonly nodes: readonly DescentNode[];
  /** Every number a person holds; more than one means the lines rejoined. */
  readonly numbersById: ReadonlyMap<PersonId, readonly string[]>;
  readonly generationsReached: number;
  readonly truncated: boolean;
  /** Distinct people, per generation. */
  readonly perGeneration: readonly number[];
}

/**
 * Children in the order d'Aboville expects: by birth.
 *
 * Undated children go last and are marked, because putting them anywhere
 * among the dated ones would assert a birth order the record does not contain.
 * Ties and undated runs fall back to display name, which is arbitrary but
 * stable — a numbering that changed between two page loads would be worse than
 * one that is merely alphabetical.
 */
function orderedChildren(
  graph: GenealogyGraph,
  parentId: PersonId,
  biologicalOnly: boolean,
): { id: PersonId; orderInferred: boolean }[] {
  const seen = new Set<PersonId>();
  const children: { id: PersonId; sort: number | null; name: string }[] = [];

  for (const edge of graph.childrenOf(parentId, biologicalOnly)) {
    if (biologicalOnly && !isBiologicalParentType(edge.type)) continue;
    // A child linked to the same parent twice — a biological and an adoptive
    // record, say — is one child, not two.
    if (seen.has(edge.targetId)) continue;
    seen.add(edge.targetId);

    const person = graph.people.get(edge.targetId);
    children.push({
      id: edge.targetId,
      sort: person?.birth?.interval.earliest ?? null,
      name: person?.displayName ?? '',
    });
  }

  children.sort((a, b) => {
    if (a.sort !== null && b.sort !== null)
      return a.sort - b.sort || a.name.localeCompare(b.name, 'fr');
    if (a.sort !== null) return -1;
    if (b.sort !== null) return 1;
    return a.name.localeCompare(b.name, 'fr');
  });

  return children.map((child) => ({ id: child.id, orderInferred: child.sort === null }));
}

export function abovilleNumbers(
  graph: GenealogyGraph,
  subjectId: PersonId,
  options: DescentOptions = {},
): DescentResult {
  const limit = options.generations ?? 6;
  const biologicalOnly = options.biologicalOnly ?? false;

  const nodes: DescentNode[] = [];
  const numbersById = new Map<PersonId, string[]>();
  const perGeneration: Set<PersonId>[] = [];
  let generationsReached = 0;
  let truncated = false;

  if (!graph.has(subjectId)) {
    return { nodes, numbersById, generationsReached: 0, truncated: false, perGeneration: [] };
  }

  function record(node: DescentNode): void {
    nodes.push(node);
    const existing = numbersById.get(node.personId);
    if (existing) existing.push(node.number);
    else numbersById.set(node.personId, [node.number]);

    perGeneration[node.generation] ??= new Set();
    perGeneration[node.generation]?.add(node.personId);
    generationsReached = Math.max(generationsReached, node.generation);
  }

  /**
   * Explicit stack rather than recursion.
   *
   * A descent of a few thousand people is shallow, but a cycle that slipped
   * past validation would blow the call stack instead of being caught by the
   * ancestry guard below — and a crash is a worse answer than a truncation.
   */
  const stack: {
    id: PersonId;
    number: string;
    generation: number;
    parentNumber: string | null;
    orderInferred: boolean;
    // The chain from the subject to here, so a cycle stops at the person who
    // closes it rather than looping forever.
    lineage: ReadonlySet<PersonId>;
  }[] = [
    {
      id: subjectId,
      number: '1',
      generation: 0,
      parentNumber: null,
      orderInferred: false,
      lineage: new Set([subjectId]),
    },
  ];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;

    record({
      personId: node.id,
      number: node.number,
      generation: node.generation,
      parentNumber: node.parentNumber,
      orderInferred: node.orderInferred,
    });

    if (node.generation >= limit) {
      if (graph.childrenOf(node.id, biologicalOnly).length > 0) truncated = true;
      continue;
    }

    const children = orderedChildren(graph, node.id, biologicalOnly);
    // Pushed in reverse so the stack yields them in birth order: the list is
    // meant to be printed as it stands.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!child || node.lineage.has(child.id)) continue;

      stack.push({
        id: child.id,
        number: `${node.number}.${index + 1}`,
        generation: node.generation + 1,
        parentNumber: node.number,
        orderInferred: child.orderInferred,
        lineage: new Set(node.lineage).add(child.id),
      });
    }
  }

  for (const numbers of numbersById.values()) numbers.sort((a, b) => a.localeCompare(b, 'en'));

  return {
    nodes,
    numbersById,
    generationsReached,
    truncated,
    perGeneration: Array.from(
      { length: generationsReached + 1 },
      (_, index) => (perGeneration[index] ?? new Set()).size,
    ),
  };
}
