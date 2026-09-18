/**
 * The constellation: the family around one person, laid out as points.
 *
 * Deterministic by construction. A force simulation would give a different
 * picture on every visit and a different one again after an unrelated edit,
 * which is the opposite of what a researcher needs from a map they return to:
 * the same family should be in the same place. So this is a radial tree
 * layout over a breadth-first walk from the focus —
 *
 * - distance from the centre is the number of links from the focus person;
 * - each person receives a wedge of the circle proportional to how many
 *   people are reached through them, so a large branch gets room and a
 *   childless cousin does not starve their neighbours;
 * - the focus person's parents are turned to the top and their children to
 *   the bottom, the orientation every family chart uses. The sweep runs
 *   clockwise like the temporal fan's — father on the left, mother on the
 *   right, as in Sosa numbering — and the descendant side is laid out in
 *   reverse, so that along the bottom siblings still read left to right,
 *   eldest first.
 *
 * Every relationship between two people in the result is returned, not only
 * the ones the walk followed: a second parent, a marriage between cousins or
 * an ancestor reached twice are exactly what a constellation should show.
 */

export type ConstellationLinkKind = 'PARENT' | 'PARTNER';

export interface ConstellationPersonInput {
  readonly id: string;
  /**
   * Orders siblings around the circle. Null sorts last, and a caller should
   * pass null for anyone whose birth date the viewer may not know, since the
   * order would otherwise disclose it.
   */
  readonly birthSortJdn: number | null;
  /**
   * Orders a pair of parents, father first, as Sosa numbering does. Null or
   * absent sorts last; pass null for a person the viewer may not see.
   */
  readonly recordedSex?: 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN' | null;
}

export interface ConstellationLinkInput {
  /** For PARENT, the parent; for PARTNER, either partner. */
  readonly from: string;
  /** For PARENT, the child. */
  readonly to: string;
  readonly kind: ConstellationLinkKind;
}

export interface ConstellationNode {
  readonly id: string;
  /** Links from the focus person along the walk. The focus is 0. */
  readonly hop: number;
  /**
   * Generations relative to the focus along the walk: parents +1, children
   * -1, partners and siblings' partners 0. A sibling is reached through a
   * parent and back down, so is also 0.
   */
  readonly generation: number;
  readonly x: number;
  /** Grows upward, as in the scene this feeds. */
  readonly y: number;
  /** The direction from the centre, in radians, counter-clockwise from +x. */
  readonly angle: number;
}

export interface ConstellationLayout<L extends ConstellationLinkInput = ConstellationLinkInput> {
  readonly nodes: readonly ConstellationNode[];
  /** The caller's own link objects, so anything they carry comes through. */
  readonly links: readonly L[];
  /** People exist beyond the hop or size limit and were left out. */
  readonly truncated: boolean;
  /** The furthest hop actually present. */
  readonly maxHop: number;
}

export interface ConstellationOptions {
  readonly maxHops: number;
  /** A ceiling on the number of people, whatever the hops allow. */
  readonly maxPeople?: number;
  /** Distance between two consecutive rings. */
  readonly ringSpacing?: number;
}

const DEFAULT_RING_SPACING = 10;
const DEFAULT_MAX_PEOPLE = 2_000;
const TAU = Math.PI * 2;

interface Neighbour {
  readonly id: string;
  /** Generation step from the current person to this one. */
  readonly step: 1 | 0 | -1;
}

/** Parents first, then partners, then children: the order a family is read in. */
const STEP_ORDER: Record<Neighbour['step'], number> = { 1: 0, 0: 1, [-1]: 2 };

const SEX_ORDER: Record<string, number> = { MALE: 0, FEMALE: 1 };

/** Which side of the focus person a branch hangs from. */
type Side = 'up' | 'level' | 'down';

export function layoutConstellation<L extends ConstellationLinkInput>(
  focusId: string,
  people: readonly ConstellationPersonInput[],
  links: readonly L[],
  options: ConstellationOptions,
): ConstellationLayout<L> {
  const byId = new Map(people.map((person) => [person.id, person]));
  if (!byId.has(focusId)) {
    return { nodes: [], links: [], truncated: false, maxHop: 0 };
  }

  const ringSpacing = options.ringSpacing ?? DEFAULT_RING_SPACING;
  const maxPeople = options.maxPeople ?? DEFAULT_MAX_PEOPLE;
  const adjacency = buildAdjacency(links, byId);

  // Breadth-first walk. `order` is the visiting order, which is also a valid
  // top-down order of the resulting tree.
  const hop = new Map<string, number>([[focusId, 0]]);
  const generation = new Map<string, number>([[focusId, 0]]);
  const side = new Map<string, Side>();
  const treeChildren = new Map<string, string[]>();
  const order: string[] = [focusId];
  let truncated = false;

  for (let index = 0; index < order.length; index += 1) {
    const current = order[index] as string;
    const currentHop = hop.get(current) ?? 0;
    const neighbours = adjacency.get(current) ?? [];

    for (const neighbour of neighbours) {
      if (hop.has(neighbour.id)) continue;
      if (currentHop + 1 > options.maxHops || order.length >= maxPeople) {
        truncated = true;
        continue;
      }
      hop.set(neighbour.id, currentHop + 1);
      generation.set(neighbour.id, (generation.get(current) ?? 0) + neighbour.step);
      side.set(
        neighbour.id,
        current === focusId
          ? neighbour.step === 1
            ? 'up'
            : neighbour.step === -1
              ? 'down'
              : 'level'
          : (side.get(current) ?? 'level'),
      );
      order.push(neighbour.id);
      const siblings = treeChildren.get(current);
      if (siblings) siblings.push(neighbour.id);
      else treeChildren.set(current, [neighbour.id]);
    }
  }

  // Room each person needs: the number of leaves reached through them.
  const weight = new Map<string, number>();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index] as string;
    const children = treeChildren.get(id) ?? [];
    const sum = children.reduce((total, child) => total + (weight.get(child) ?? 1), 0);
    weight.set(id, Math.max(1, sum));
  }

  // The order each person's wedge is shared out in. The sweep is clockwise,
  // which reads left to right across the top and right to left across the
  // bottom; the descendant side is reversed so it too reads left to right.
  const sweepOrder = (id: string): string[] => {
    const children = treeChildren.get(id) ?? [];
    if (id === focusId) {
      const down = children.filter((child) => side.get(child) === 'down');
      return [...children.filter((child) => side.get(child) !== 'down'), ...down.reverse()];
    }
    return side.get(id) === 'down' ? [...children].reverse() : [...children];
  };

  // Wedges, top-down, as positions along the sweep. Each person divides
  // their wedge between the people reached through them, in proportion to
  // the room those people need.
  const wedge = new Map<string, readonly [number, number]>([[focusId, [0, TAU]]]);
  for (const id of order) {
    const [start, end] = wedge.get(id) ?? [0, TAU];
    const children = sweepOrder(id);
    const total = children.reduce((sum, child) => sum + (weight.get(child) ?? 1), 0);
    let cursor = start;
    for (const child of children) {
      const span = ((end - start) * (weight.get(child) ?? 1)) / total;
      wedge.set(child, [cursor, cursor + span]);
      cursor += span;
    }
  }

  const rotation = orientation(sweepOrder(focusId), side, wedge);

  const nodes: ConstellationNode[] = order.map((id) => {
    const [start, end] = wedge.get(id) ?? [0, TAU];
    const personHop = hop.get(id) ?? 0;
    // Clockwise: further along the sweep is a smaller angle.
    const angle = normaliseAngle(rotation - (start + end) / 2);
    const radius = personHop * ringSpacing;
    return {
      id,
      hop: personHop,
      generation: generation.get(id) ?? 0,
      x: personHop === 0 ? 0 : radius * Math.cos(angle),
      y: personHop === 0 ? 0 : radius * Math.sin(angle),
      angle: personHop === 0 ? 0 : angle,
    };
  });

  const included = new Set(order);
  const keptLinks = links.filter((link) => included.has(link.from) && included.has(link.to));
  const maxHop = nodes.reduce((max, node) => Math.max(max, node.hop), 0);

  return { nodes, links: dedupeLinks(keptLinks), truncated, maxHop };
}

function buildAdjacency(
  links: readonly ConstellationLinkInput[],
  byId: ReadonlyMap<string, ConstellationPersonInput>,
): Map<string, Neighbour[]> {
  const adjacency = new Map<string, Neighbour[]>();
  const add = (from: string, neighbour: Neighbour) => {
    const list = adjacency.get(from);
    if (list) list.push(neighbour);
    else adjacency.set(from, [neighbour]);
  };

  for (const link of links) {
    if (!byId.has(link.from) || !byId.has(link.to) || link.from === link.to) continue;
    if (link.kind === 'PARENT') {
      // From the child, the parent is one generation up; from the parent,
      // the child is one down.
      add(link.to, { id: link.from, step: 1 });
      add(link.from, { id: link.to, step: -1 });
    } else {
      add(link.from, { id: link.to, step: 0 });
      add(link.to, { id: link.from, step: 0 });
    }
  }

  for (const [id, list] of adjacency) {
    // A person linked twice to the same neighbour (two parent types, say)
    // is still one neighbour; keep the first by the reading order.
    const seen = new Set<string>();
    const sorted = [...list].sort((a, b) => compareNeighbours(a, b, byId));
    adjacency.set(
      id,
      sorted.filter((neighbour) => {
        if (seen.has(neighbour.id)) return false;
        seen.add(neighbour.id);
        return true;
      }),
    );
  }
  return adjacency;
}

function compareNeighbours(
  a: Neighbour,
  b: Neighbour,
  byId: ReadonlyMap<string, ConstellationPersonInput>,
): number {
  const byStep = STEP_ORDER[a.step] - STEP_ORDER[b.step];
  if (byStep !== 0) return byStep;
  if (a.step === 1) {
    const aSex = SEX_ORDER[byId.get(a.id)?.recordedSex ?? ''] ?? 2;
    const bSex = SEX_ORDER[byId.get(b.id)?.recordedSex ?? ''] ?? 2;
    if (aSex !== bSex) return aSex - bSex;
  }
  const aBirth = byId.get(a.id)?.birthSortJdn ?? null;
  const bBirth = byId.get(b.id)?.birthSortJdn ?? null;
  if (aBirth !== bBirth) {
    if (aBirth === null) return 1;
    if (bBirth === null) return -1;
    return aBirth - bBirth;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The turn that puts the focus person's parents at the top, or — with no
 * parents recorded — their children at the bottom. With neither, partners
 * are left where the sweep put them.
 */
function orientation(
  first: readonly string[],
  side: ReadonlyMap<string, Side>,
  wedge: ReadonlyMap<string, readonly [number, number]>,
): number {
  const middleOf = (ids: readonly string[]): number | null => {
    if (ids.length === 0) return null;
    const start = wedge.get(ids[0] as string)?.[0] ?? 0;
    const end = wedge.get(ids[ids.length - 1] as string)?.[1] ?? 0;
    return (start + end) / 2;
  };

  // The sweep lists parents first and children last, so each group's
  // wedges are contiguous.
  const parents = middleOf(first.filter((id) => side.get(id) === 'up'));
  if (parents !== null) return Math.PI / 2 + parents;
  const children = middleOf(first.filter((id) => side.get(id) === 'down'));
  if (children !== null) return -Math.PI / 2 + children;
  return 0;
}

function normaliseAngle(angle: number): number {
  const turned = angle % TAU;
  return turned < 0 ? turned + TAU : turned;
}

function dedupeLinks<L extends ConstellationLinkInput>(links: readonly L[]): L[] {
  const seen = new Set<string>();
  const kept: L[] = [];
  for (const link of links) {
    const key =
      link.kind === 'PARENT'
        ? `P:${link.from}:${link.to}`
        : `U:${[link.from, link.to].sort().join(':')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(link);
  }
  return kept;
}
