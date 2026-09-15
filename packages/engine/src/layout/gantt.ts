import type { GenealogyGraph, PersonId } from '@chronolignee/genealogy';

/**
 * Row assignment for the genealogical Gantt.
 *
 * The horizontal axis is time and cannot be negotiated. All the layout can
 * choose is the vertical order, and that choice is what decides whether the
 * view reads as a family or as a bar chart.
 *
 * The ordering is a depth-first walk from the oldest roots, visiting each
 * person's children in birth order. That keeps a family contiguous: a parent
 * sits directly above their children, so the relationship links are short and
 * mostly vertical instead of crossing the whole screen. Sorting purely by
 * birth date — the obvious alternative — interleaves unrelated branches and
 * turns every link into a long diagonal.
 */

export interface GanttRow {
  readonly personId: PersonId;
  readonly row: number;
  /** Generational depth from the walk's root, for banding and indentation. */
  readonly depth: number;
  /** Stable key identifying the branch, used to pick a colour. */
  readonly branchKey: string;
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
  readonly latestIsOpen: boolean;
}

export interface GanttLayout {
  readonly rows: readonly GanttRow[];
  readonly rowByPersonId: ReadonlyMap<PersonId, number>;
  /** Extent of everything laid out, for an initial fit. */
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
  readonly maxDepth: number;
}

export interface GanttLayoutOptions {
  /**
   * Restrict to these people. Used when a filter or a focus has narrowed the
   * projection; relationships to anyone outside the set are ignored.
   */
  readonly include?: ReadonlySet<PersonId>;
  /** Start the walk here instead of at the graph's roots. */
  readonly rootId?: PersonId;
}

function birthKey(graph: GenealogyGraph, id: PersonId): number {
  const person = graph.people.get(id);
  const earliest = person?.lifespan?.earliest ?? person?.birth?.interval.earliest;
  // People with no date sort last rather than to the beginning of time, which
  // is where a null would put them and where they certainly do not belong.
  return earliest ?? Number.POSITIVE_INFINITY;
}

export function layoutGantt(graph: GenealogyGraph, options: GanttLayoutOptions = {}): GanttLayout {
  const include = options.include;
  const visible = (id: PersonId): boolean => graph.has(id) && (!include || include.has(id));

  const roots = options.rootId ? [options.rootId].filter(visible) : findRoots(graph, visible);

  const rows: GanttRow[] = [];
  const rowByPersonId = new Map<PersonId, number>();
  const placed = new Set<PersonId>();
  let maxDepth = 0;

  const place = (id: PersonId, depth: number, branchKey: string): void => {
    if (placed.has(id) || !visible(id)) return;
    placed.add(id);

    const person = graph.people.get(id);
    const row = rows.length;
    rowByPersonId.set(id, row);
    maxDepth = Math.max(maxDepth, depth);

    rows.push({
      personId: id,
      row,
      depth,
      branchKey,
      earliestJdn: person?.lifespan?.earliest ?? person?.birth?.interval.earliest ?? null,
      latestJdn: person?.lifespan?.latest ?? null,
      // An open right edge is drawn as a fade rather than a boundary, so the
      // layout has to carry the distinction the data makes.
      latestIsOpen: (person?.death?.interval.latest ?? null) === null,
    });

    // Partners go immediately below, so a couple reads as a couple and the
    // marriage link is one row long.
    for (const edge of graph.partnersOf(id)) {
      const partnerId = edge.sourceId === id ? edge.targetId : edge.sourceId;
      if (!placed.has(partnerId) && visible(partnerId)) {
        place(partnerId, depth, branchKey);
      }
    }

    const children = graph
      .childrenOf(id)
      .map((edge) => edge.targetId)
      .filter((childId) => visible(childId) && !placed.has(childId))
      .sort((a, b) => birthKey(graph, a) - birthKey(graph, b));

    // A branch begins at a fork, not at the root.
    //
    // Keying every descendant of one root to that root gives a connected
    // family exactly one branch, and therefore one colour — technically true
    // and visually useless. Colour is only worth spending where it separates
    // something: the first place a line divides is the first place a reader
    // needs to tell two lines apart.
    const forks = children.filter((childId) => graph.childrenOf(childId).length > 0);
    const startsNewBranch = forks.length > 1;

    for (const childId of children) {
      place(childId, depth + 1, startsNewBranch ? childId : branchKey);
    }
  };

  // Oldest root first, so the timeline reads left to right and top to bottom
  // in the same direction.
  const orderedRoots = [...roots].sort((a, b) => birthKey(graph, a) - birthKey(graph, b));
  for (const rootId of orderedRoots) {
    place(rootId, 0, rootId);
  }

  // Anyone the walk could not reach — an unattached record, a duplicate lifted
  // from an index — still belongs on the timeline. Dropping them would hide
  // exactly the people most in need of attention.
  const orphans = [...graph.people.keys()]
    .filter((id) => visible(id) && !placed.has(id))
    .sort((a, b) => birthKey(graph, a) - birthKey(graph, b));
  for (const id of orphans) {
    place(id, 0, id);
  }

  let earliestJdn: number | null = null;
  let latestJdn: number | null = null;
  for (const row of rows) {
    if (row.earliestJdn !== null) {
      earliestJdn = earliestJdn === null ? row.earliestJdn : Math.min(earliestJdn, row.earliestJdn);
    }
    if (row.latestJdn !== null) {
      latestJdn = latestJdn === null ? row.latestJdn : Math.max(latestJdn, row.latestJdn);
    }
  }

  return { rows, rowByPersonId, earliestJdn, latestJdn, maxDepth };
}

/**
 * People with no visible parents — where a walk down the tree should start.
 * If pedigree collapse or a cycle leaves nothing rootless, fall back to the
 * earliest-born person so the layout still produces something.
 */
function findRoots(graph: GenealogyGraph, visible: (id: PersonId) => boolean): PersonId[] {
  const roots: PersonId[] = [];
  for (const id of graph.people.keys()) {
    if (!visible(id)) continue;
    const parents = graph.parentsOf(id).filter((edge) => visible(edge.sourceId));
    if (parents.length === 0) roots.push(id);
  }

  if (roots.length > 0) return roots;

  const anyone = [...graph.people.keys()].filter(visible);
  anyone.sort((a, b) => birthKey(graph, a) - birthKey(graph, b));
  return anyone.slice(0, 1);
}

/** Links between rows, for drawing relationships on the laid-out timeline. */
export interface GanttLink {
  readonly id: string;
  readonly fromRow: number;
  readonly toRow: number;
  /** Where on the time axis the link belongs: the child's birth, or the marriage. */
  readonly jdn: number | null;
  readonly kind: 'PARENT' | 'PARTNER';
}

export function ganttLinks(graph: GenealogyGraph, layout: GanttLayout): GanttLink[] {
  const links: GanttLink[] = [];

  for (const edge of graph.edges) {
    const fromRow = layout.rowByPersonId.get(edge.sourceId);
    const toRow = layout.rowByPersonId.get(edge.targetId);
    if (fromRow === undefined || toRow === undefined) continue;

    if (edge.type.startsWith('PARENT_')) {
      // Drawn at the child's birth: the moment the relationship began, not an
      // arbitrary midpoint between two lifespans.
      const child = graph.people.get(edge.targetId);
      links.push({
        id: edge.id,
        fromRow,
        toRow,
        jdn: child?.birth?.interval.earliest ?? child?.lifespan?.earliest ?? null,
        kind: 'PARENT',
      });
      continue;
    }

    if (edge.startJdn != null) {
      links.push({ id: edge.id, fromRow, toRow, jdn: edge.startJdn, kind: 'PARTNER' });
    }
  }

  return links;
}
