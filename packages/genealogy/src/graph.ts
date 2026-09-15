import type { GenealogicalDate, JdnInterval } from '@chronolignee/domain';

/**
 * In-memory genealogical graph.
 *
 * The database answers traversal questions with recursive CTEs (ADR 0001).
 * This structure exists for the cases where that is the wrong tool: the layout
 * worker, which needs the whole visible subgraph at once and would otherwise
 * make one round trip per generation; validation, which must test a proposed
 * edge that does not exist yet; and the test suite, which needs graphs without
 * a database.
 *
 * It is a projection, never a source of truth. It is built from rows and
 * thrown away.
 */

export type PersonId = string;

export const PARENT_RELATIONSHIP_TYPES = [
  'PARENT_BIOLOGICAL',
  'PARENT_ADOPTIVE',
  'PARENT_FOSTER',
  'PARENT_STEP',
  'PARENT_GUARDIAN',
  'PARENT_UNKNOWN',
] as const;
export type ParentRelationshipType = (typeof PARENT_RELATIONSHIP_TYPES)[number];

export const PARTNER_RELATIONSHIP_TYPES = ['SPOUSE', 'PARTNER', 'DIVORCED_PARTNER'] as const;
export type PartnerRelationshipType = (typeof PARTNER_RELATIONSHIP_TYPES)[number];

export type RelationshipType =
  ParentRelationshipType | PartnerRelationshipType | 'SIBLING' | 'OTHER';

export function isParentType(type: RelationshipType): type is ParentRelationshipType {
  return (PARENT_RELATIONSHIP_TYPES as readonly string[]).includes(type);
}

export function isPartnerType(type: RelationshipType): type is PartnerRelationshipType {
  return (PARTNER_RELATIONSHIP_TYPES as readonly string[]).includes(type);
}

/**
 * Only biological parentage carries genetic ancestry. An adoptive line is a
 * real family line and appears in the tree, but "ancestors" means something
 * different for the two and conflating them produces wrong answers to both
 * questions.
 */
export function isBiologicalParentType(type: RelationshipType): boolean {
  return type === 'PARENT_BIOLOGICAL';
}

export interface GraphPerson {
  readonly id: PersonId;
  readonly displayName: string;
  readonly birth?: GenealogicalDate | null;
  readonly death?: GenealogicalDate | null;
  readonly lifespan?: JdnInterval | null;
  readonly isDeceased?: boolean | null;
}

export interface GraphEdge {
  readonly id: string;
  /** For parent types: the parent. */
  readonly sourceId: PersonId;
  /** For parent types: the child. */
  readonly targetId: PersonId;
  readonly type: RelationshipType;
  readonly startJdn?: number | null;
  readonly endJdn?: number | null;
}

export interface TraversalOptions {
  /** Stop after this many generations. 0 means the origin only. */
  readonly maxDepth?: number;
  /** Restrict to biological parentage. Default: every parent type. */
  readonly biologicalOnly?: boolean;
}

export interface TraversalResult {
  /** Reachable people, with their shortest generational distance from origin. */
  readonly depthById: ReadonlyMap<PersonId, number>;
  /** Ids in breadth-first order, so callers can render generation by generation. */
  readonly order: readonly PersonId[];
  /**
   * People reachable by more than one path — pedigree collapse. In real
   * genealogies this is common (cousins marrying) and the count matters:
   * without it, "number of ancestors" is double-counted.
   */
  readonly implexIds: ReadonlySet<PersonId>;
  /** True when traversal stopped at maxDepth rather than running out of people. */
  readonly truncated: boolean;
}

export class GenealogyGraph {
  readonly people: ReadonlyMap<PersonId, GraphPerson>;
  readonly edges: readonly GraphEdge[];

  /** child -> parent edges */
  private readonly parentEdges: Map<PersonId, GraphEdge[]>;
  /** parent -> child edges */
  private readonly childEdges: Map<PersonId, GraphEdge[]>;
  /** person -> partner edges (undirected) */
  private readonly partnerEdges: Map<PersonId, GraphEdge[]>;

  constructor(people: readonly GraphPerson[], edges: readonly GraphEdge[]) {
    this.people = new Map(people.map((p) => [p.id, p]));
    this.edges = edges;
    this.parentEdges = new Map();
    this.childEdges = new Map();
    this.partnerEdges = new Map();

    for (const edge of edges) {
      if (isParentType(edge.type)) {
        push(this.parentEdges, edge.targetId, edge);
        push(this.childEdges, edge.sourceId, edge);
      } else if (isPartnerType(edge.type)) {
        push(this.partnerEdges, edge.sourceId, edge);
        push(this.partnerEdges, edge.targetId, edge);
      }
    }
  }

  get size(): number {
    return this.people.size;
  }

  has(id: PersonId): boolean {
    return this.people.has(id);
  }

  parentsOf(id: PersonId, biologicalOnly = false): GraphEdge[] {
    const edges = this.parentEdges.get(id) ?? [];
    return biologicalOnly ? edges.filter((e) => isBiologicalParentType(e.type)) : edges;
  }

  childrenOf(id: PersonId, biologicalOnly = false): GraphEdge[] {
    const edges = this.childEdges.get(id) ?? [];
    return biologicalOnly ? edges.filter((e) => isBiologicalParentType(e.type)) : edges;
  }

  partnersOf(id: PersonId): GraphEdge[] {
    return this.partnerEdges.get(id) ?? [];
  }

  /** Full siblings share both parents; half siblings share one. */
  siblingsOf(id: PersonId, biologicalOnly = false): PersonId[] {
    const parents = this.parentsOf(id, biologicalOnly).map((e) => e.sourceId);
    const seen = new Set<PersonId>();
    for (const parentId of parents) {
      for (const edge of this.childrenOf(parentId, biologicalOnly)) {
        if (edge.targetId !== id) seen.add(edge.targetId);
      }
    }
    return [...seen];
  }

  ancestorsOf(origin: PersonId, options: TraversalOptions = {}): TraversalResult {
    return this.traverse(origin, options, (id, bio) =>
      this.parentsOf(id, bio).map((e) => e.sourceId),
    );
  }

  descendantsOf(origin: PersonId, options: TraversalOptions = {}): TraversalResult {
    return this.traverse(origin, options, (id, bio) =>
      this.childrenOf(id, bio).map((e) => e.targetId),
    );
  }

  /**
   * Breadth-first traversal shared by ancestors and descendants.
   *
   * Iterative rather than recursive on purpose: a corrupt graph containing a
   * cycle would blow the stack, and a visited set turns that same corruption
   * into a terminating traversal. Robustness here matters because the input
   * can be an imported GEDCOM from software with weaker validation than ours.
   */
  private traverse(
    origin: PersonId,
    options: TraversalOptions,
    step: (id: PersonId, biologicalOnly: boolean) => PersonId[],
  ): TraversalResult {
    const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
    const biologicalOnly = options.biologicalOnly ?? false;

    const depthById = new Map<PersonId, number>();
    const order: PersonId[] = [];
    const implexIds = new Set<PersonId>();
    let truncated = false;

    if (!this.people.has(origin)) {
      return { depthById, order, implexIds, truncated };
    }

    depthById.set(origin, 0);
    order.push(origin);
    let frontier: PersonId[] = [origin];
    let depth = 0;

    while (frontier.length > 0) {
      if (depth >= maxDepth) {
        // Only a truncation if there was actually something further out.
        truncated = frontier.some((id) => step(id, biologicalOnly).length > 0);
        break;
      }
      depth += 1;

      const next: PersonId[] = [];
      for (const current of frontier) {
        for (const neighbour of step(current, biologicalOnly)) {
          if (!this.people.has(neighbour)) continue;
          if (depthById.has(neighbour)) {
            // Reached again by a different path: pedigree collapse.
            if (neighbour !== origin) implexIds.add(neighbour);
            continue;
          }
          depthById.set(neighbour, depth);
          order.push(neighbour);
          next.push(neighbour);
        }
      }
      frontier = next;
    }

    return { depthById, order, implexIds, truncated };
  }

  /**
   * Would adding this parent edge create a cycle?
   *
   * Asked before the write, about an edge that does not exist yet, which is
   * why it cannot be a database constraint. Someone is their own ancestor is
   * not a warning to surface later — it is a state the graph must never enter,
   * because every traversal downstream assumes acyclicity.
   */
  wouldCreateCycle(parentId: PersonId, childId: PersonId): boolean {
    if (parentId === childId) return true;
    // A cycle appears exactly when the proposed parent is already a descendant
    // of the proposed child.
    return this.descendantsOf(childId).depthById.has(parentId);
  }

  /**
   * Every cycle currently present. Should always be empty; a non-empty result
   * means data arrived through a path that skipped validation, such as an
   * import from software that permits it.
   */
  findCycles(): PersonId[][] {
    const cycles: PersonId[][] = [];
    const colour = new Map<PersonId, 'grey' | 'black'>();
    const stack: PersonId[] = [];

    const visit = (start: PersonId): void => {
      // Explicit stack, for the same reason traverse() uses one.
      const work: Array<{ id: PersonId; expanded: boolean }> = [{ id: start, expanded: false }];

      while (work.length > 0) {
        const frame = work[work.length - 1] as { id: PersonId; expanded: boolean };
        const { id } = frame;

        if (!frame.expanded) {
          if (colour.get(id) === 'black') {
            work.pop();
            continue;
          }
          if (colour.get(id) === 'grey') {
            const at = stack.indexOf(id);
            if (at >= 0) cycles.push(stack.slice(at));
            work.pop();
            continue;
          }
          colour.set(id, 'grey');
          stack.push(id);
          frame.expanded = true;

          for (const edge of this.parentsOf(id)) {
            work.push({ id: edge.sourceId, expanded: false });
          }
          continue;
        }

        colour.set(id, 'black');
        stack.pop();
        work.pop();
      }
    };

    for (const id of this.people.keys()) {
      if (!colour.has(id)) visit(id);
    }
    return cycles;
  }

  /**
   * Connected components over parent and partner edges — the family branches.
   * A tree with several components usually means an import merged two
   * unconnected families, which is worth telling the user.
   */
  components(): PersonId[][] {
    const seen = new Set<PersonId>();
    const result: PersonId[][] = [];

    for (const id of this.people.keys()) {
      if (seen.has(id)) continue;

      const component: PersonId[] = [];
      const queue = [id];
      seen.add(id);

      while (queue.length > 0) {
        const current = queue.pop() as PersonId;
        component.push(current);

        const neighbours = [
          ...this.parentsOf(current).map((e) => e.sourceId),
          ...this.childrenOf(current).map((e) => e.targetId),
          ...this.partnersOf(current).map((e) =>
            e.sourceId === current ? e.targetId : e.sourceId,
          ),
        ];

        for (const neighbour of neighbours) {
          if (!seen.has(neighbour) && this.people.has(neighbour)) {
            seen.add(neighbour);
            queue.push(neighbour);
          }
        }
      }
      result.push(component);
    }
    return result;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
