import { isBiologicalParentType, type GenealogyGraph, type PersonId } from './graph';

/**
 * Ancestry as genealogists actually address it.
 *
 * `ancestorsOf` answers "who is above this person", which is a graph question.
 * This file answers the genealogical ones: what is this ancestor's Sosa
 * number, how are these two people related, and how much of the pedigree is
 * actually filled in. Those are the questions a researcher asks out loud, and
 * they have precise answers that a generic graph API cannot give.
 */

/**
 * The generation at which Sosa numbers stop being exact.
 *
 * A Sosa number doubles every generation, so generation 54 needs more than
 * 2^53 and JavaScript integers stop being exact there. No documented human
 * pedigree comes close — forty generations is roughly the deepest royal line
 * on record — but silently emitting a wrong number is worse than stopping, so
 * the traversal reports that it stopped.
 */
export const MAX_EXACT_SOSA_GENERATION = 53;

export interface SosaOptions {
  /** Generations above the subject. The subject is generation 0. */
  readonly generations?: number;
  /**
   * Whether to follow only biological parentage.
   *
   * Sosa numbering describes biological descent: an adoptive father is a
   * father in every sense that matters to a family and not in the sense this
   * numbering encodes. Defaulting to true keeps the number meaning what
   * genealogists read it to mean; the UI can say the adoptive line is there.
   */
  readonly biologicalOnly?: boolean;
}

export interface SosaResult {
  /**
   * Sosa-Stradonitz numbers per person, ascending.
   *
   * A list rather than a single number, because one person can occupy several
   * positions in the same pedigree. That is not a defect to deduplicate away:
   * two numbers for one ancestor IS pedigree collapse, and it is how the
   * phenomenon has been recorded since the eighteenth century.
   */
  readonly numbersById: ReadonlyMap<PersonId, readonly number[]>;
  /** Who stands at each number. */
  readonly personByNumber: ReadonlyMap<number, PersonId>;
  /** Deepest generation reached, subject being 0. */
  readonly generationsReached: number;
  /** True when the walk stopped at the requested depth rather than the top. */
  readonly truncated: boolean;
  /** True when the walk stopped because numbers would stop being exact. */
  readonly precisionLimited: boolean;
}

/**
 * Sosa-Stradonitz numbering from a subject.
 *
 * Subject 1, father 2n, mother 2n+1. When the recorded sex of a parent is
 * unknown the assignment cannot be guessed — and guessing is exactly the kind
 * of fake precision this product refuses — so an unsexed parent takes the
 * first free slot of the couple and the caller is free to show that the
 * position is provisional.
 */
export function sosaNumbers(
  graph: GenealogyGraph,
  subjectId: PersonId,
  options: SosaOptions = {},
): SosaResult {
  const requested = options.generations ?? 10;
  const biologicalOnly = options.biologicalOnly ?? true;
  const limit = Math.min(requested, MAX_EXACT_SOSA_GENERATION);

  const numbersById = new Map<PersonId, number[]>();
  const personByNumber = new Map<number, PersonId>();
  let generationsReached = 0;
  let truncated = false;

  if (!graph.has(subjectId)) {
    return {
      numbersById,
      personByNumber,
      generationsReached: 0,
      truncated: false,
      precisionLimited: false,
    };
  }

  // Breadth-first by number, so a person who appears twice gets both numbers
  // and the lower one is found first. Depth-first would assign numbers in an
  // order that depends on which parent happened to be entered first.
  let frontier: { id: PersonId; sosa: number; generation: number }[] = [
    { id: subjectId, sosa: 1, generation: 0 },
  ];

  while (frontier.length > 0) {
    const next: typeof frontier = [];

    for (const node of frontier) {
      const existing = numbersById.get(node.id);
      if (existing) existing.push(node.sosa);
      else numbersById.set(node.id, [node.sosa]);
      personByNumber.set(node.sosa, node.id);
      generationsReached = Math.max(generationsReached, node.generation);

      if (node.generation >= limit) {
        // Only a truncation if there was actually something above.
        if (graph.parentsOf(node.id, biologicalOnly).length > 0) truncated = true;
        continue;
      }

      const parents = graph
        .parentsOf(node.id, biologicalOnly)
        .filter((edge) => !biologicalOnly || isBiologicalParentType(edge.type));

      const father = parents.find(
        (edge) => graph.people.get(edge.sourceId)?.recordedSex === 'MALE',
      );
      const mother = parents.find(
        (edge) => graph.people.get(edge.sourceId)?.recordedSex === 'FEMALE',
      );
      const unplaced = parents.filter((edge) => edge !== father && edge !== mother);

      const slots: (PersonId | undefined)[] = [father?.sourceId, mother?.sourceId];
      for (const edge of unplaced) {
        const free = slots.findIndex((slot) => slot === undefined);
        // More than two recorded parents is a real situation — a biological
        // and an adoptive father both recorded as PARENT_UNKNOWN, say. The
        // extra ones have no Sosa position; dropping them here is honest,
        // and the relationship list still shows them.
        if (free === -1) break;
        slots[free] = edge.sourceId;
      }

      slots.forEach((personId, index) => {
        if (!personId) return;
        next.push({
          id: personId,
          sosa: node.sosa * 2 + index,
          generation: node.generation + 1,
        });
      });
    }

    frontier = next;
  }

  for (const numbers of numbersById.values()) numbers.sort((a, b) => a - b);

  return {
    numbersById,
    personByNumber,
    generationsReached,
    truncated,
    precisionLimited: requested > MAX_EXACT_SOSA_GENERATION,
  };
}

export interface PedigreeCompleteness {
  /** Generation index, subject being 0. */
  readonly generation: number;
  /** How many ancestors this generation could hold: 2^generation. */
  readonly possible: number;
  /** How many distinct people are actually recorded in it. */
  readonly known: number;
  /**
   * Distinct people, not filled positions.
   *
   * With pedigree collapse the same person occupies several slots, and
   * counting slots would report a fuller pedigree than the research supports —
   * the classic way software flatters its user.
   */
  readonly filledPositions: number;
}

/**
 * How much of the pedigree is actually filled in.
 *
 * The honest measure of a piece of research, and the one genealogists quote
 * to each other. Reported per generation because an average hides the shape:
 * "62 % complete" says nothing, while "complete to generation 5, then one
 * branch only" says where the winter's work should go.
 */
export function pedigreeCompleteness(
  result: SosaResult,
  /**
   * How deep to report, when the caller wants to show generations the walk
   * found nobody in. A pedigree that stops reporting at its last populated
   * generation looks complete at every depth it prints — and never once shows
   * the wall the research has hit.
   */
  throughGeneration = result.generationsReached,
): PedigreeCompleteness[] {
  const byGeneration = new Map<number, { people: Set<PersonId>; positions: number }>();

  for (const [personId, numbers] of result.numbersById) {
    for (const sosa of numbers) {
      const generation = Math.floor(Math.log2(sosa));
      const bucket = byGeneration.get(generation) ?? { people: new Set(), positions: 0 };
      bucket.people.add(personId);
      bucket.positions += 1;
      byGeneration.set(generation, bucket);
    }
  }

  const rows: PedigreeCompleteness[] = [];
  for (let generation = 0; generation <= throughGeneration; generation += 1) {
    const bucket = byGeneration.get(generation);
    rows.push({
      generation,
      possible: 2 ** generation,
      known: bucket?.people.size ?? 0,
      filledPositions: bucket?.positions ?? 0,
    });
  }
  return rows;
}

export type KinshipCode =
  | 'SELF'
  | 'ANCESTOR'
  | 'DESCENDANT'
  | 'SIBLING'
  | 'PIBLING'
  | 'NIBLING'
  | 'COUSIN'
  | 'PARTNER'
  | 'UNRELATED';

export interface Kinship {
  readonly code: KinshipCode;
  /** Generations from the subject up to the common ancestor. */
  readonly up: number;
  /** Generations from the other person up to the common ancestor. */
  readonly down: number;
  /** Cousin degree: 1 = germain (first cousin). Zero for other codes. */
  readonly degree: number;
  /** Generational offset between two cousins. Zero when they are level. */
  readonly removal: number;
  /** The nearest shared ancestors, usually a couple. */
  readonly through: readonly PersonId[];
}

/**
 * How two people are related.
 *
 * Returned as a code plus numbers, never as a rendered phrase. "Cousin issu
 * de germain" and "first cousin once removed" do not decompose the same way,
 * and a relationship computed in a worker has to render in whichever language
 * the reader is using.
 *
 * Nearest common ancestor, not any common ancestor: in a family with any
 * pedigree collapse almost everyone shares someone eventually, and the useful
 * answer is the closest link.
 */
export function kinship(
  graph: GenealogyGraph,
  subjectId: PersonId,
  otherId: PersonId,
  options: { readonly maxGenerations?: number; readonly biologicalOnly?: boolean } = {},
): Kinship {
  const none: Kinship = {
    code: 'UNRELATED',
    up: 0,
    down: 0,
    degree: 0,
    removal: 0,
    through: [],
  };

  if (!graph.has(subjectId) || !graph.has(otherId)) return none;
  if (subjectId === otherId) return { ...none, code: 'SELF' };

  const maxDepth = options.maxGenerations ?? 20;
  const biologicalOnly = options.biologicalOnly ?? true;
  const traversal = { maxDepth, biologicalOnly };

  // A partner is not a blood relation and has no common ancestor to find, so
  // it is answered before the walk rather than falling through to UNRELATED —
  // which would be true and unhelpful.
  if (
    graph
      .partnersOf(subjectId)
      .some((edge) => edge.sourceId === otherId || edge.targetId === otherId)
  ) {
    return { ...none, code: 'PARTNER' };
  }

  const subjectUp = graph.ancestorsOf(subjectId, traversal).depthById;
  const otherUp = graph.ancestorsOf(otherId, traversal).depthById;

  if (otherUp.has(subjectId)) {
    const down = otherUp.get(subjectId) ?? 0;
    return { ...none, code: 'ANCESTOR', up: 0, down, through: [subjectId] };
  }
  if (subjectUp.has(otherId)) {
    const up = subjectUp.get(otherId) ?? 0;
    return { ...none, code: 'DESCENDANT', up, down: 0, through: [otherId] };
  }

  // The nearest shared ancestors, by the smallest total distance. Ties are
  // kept together because the answer is normally a couple, and naming only
  // one of them would quietly pick a side of the family.
  let best = Infinity;
  let through: PersonId[] = [];
  let bestUp = 0;
  let bestDown = 0;

  for (const [ancestorId, up] of subjectUp) {
    const down = otherUp.get(ancestorId);
    if (down === undefined) continue;
    const total = up + down;
    if (total < best) {
      best = total;
      through = [ancestorId];
      bestUp = up;
      bestDown = down;
    } else if (total === best && up === bestUp) {
      through.push(ancestorId);
    }
  }

  if (through.length === 0) return none;

  if (bestUp === 1 && bestDown === 1) {
    return { ...none, code: 'SIBLING', up: 1, down: 1, through };
  }
  // Aunt, uncle, great-aunt: the other person is one step off a direct line.
  if (bestDown === 1) {
    return { ...none, code: 'PIBLING', up: bestUp, down: 1, removal: bestUp - 1, through };
  }
  if (bestUp === 1) {
    return { ...none, code: 'NIBLING', up: 1, down: bestDown, removal: bestDown - 1, through };
  }

  return {
    ...none,
    code: 'COUSIN',
    up: bestUp,
    down: bestDown,
    degree: Math.min(bestUp, bestDown) - 1,
    removal: Math.abs(bestUp - bestDown),
    through,
  };
}
