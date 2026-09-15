import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseGenealogicalDate } from '@chronolignee/domain';
import { GenealogyGraph, type GraphEdge, type GraphPerson } from './graph';

function person(id: string, birth?: string, death?: string): GraphPerson {
  return {
    id,
    displayName: id,
    birth: birth ? parseGenealogicalDate(birth) : null,
    death: death ? parseGenealogicalDate(death) : null,
  };
}

function parentOf(parent: string, child: string, type: GraphEdge['type'] = 'PARENT_BIOLOGICAL') {
  return { id: `${parent}->${child}:${type}`, sourceId: parent, targetId: child, type };
}

/** Builds a chain root -> child -> grandchild -> ... of the given depth. */
function chain(depth: number) {
  const people = Array.from({ length: depth }, (_, i) => person(`p${i}`));
  const edges = Array.from({ length: depth - 1 }, (_, i) => parentOf(`p${i}`, `p${i + 1}`));
  return new GenealogyGraph(people, edges);
}

describe('traversal', () => {
  it('walks ancestors with correct generational depth', () => {
    const graph = chain(4);
    const result = graph.ancestorsOf('p3');
    expect(result.depthById.get('p3')).toBe(0);
    expect(result.depthById.get('p2')).toBe(1);
    expect(result.depthById.get('p1')).toBe(2);
    expect(result.depthById.get('p0')).toBe(3);
  });

  it('walks descendants symmetrically', () => {
    const graph = chain(4);
    const result = graph.descendantsOf('p0');
    expect(result.depthById.get('p3')).toBe(3);
    expect(result.order[0]).toBe('p0');
  });

  it('respects maxDepth and reports truncation', () => {
    const graph = chain(5);
    const result = graph.ancestorsOf('p4', { maxDepth: 2 });
    expect(result.depthById.size).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it('does not report truncation when the graph simply ends', () => {
    const graph = chain(3);
    expect(graph.ancestorsOf('p2', { maxDepth: 10 }).truncated).toBe(false);
  });

  it('returns an empty result for an unknown person', () => {
    expect(chain(3).ancestorsOf('nobody').order).toEqual([]);
  });

  it('separates biological from adoptive lines', () => {
    const graph = new GenealogyGraph(
      [person('bio'), person('adopt'), person('child')],
      [
        parentOf('bio', 'child', 'PARENT_BIOLOGICAL'),
        parentOf('adopt', 'child', 'PARENT_ADOPTIVE'),
      ],
    );
    expect(graph.ancestorsOf('child').depthById.size).toBe(3);
    // Genetic ancestry follows only the biological edge.
    expect(graph.ancestorsOf('child', { biologicalOnly: true }).depthById.size).toBe(2);
  });
});

describe('pedigree collapse', () => {
  it('detects a common ancestor reached by two paths', () => {
    // Two cousins marry; their child descends from the same couple twice.
    const graph = new GenealogyGraph(
      ['ancestor', 'a', 'b', 'child'].map((id) => person(id)),
      [
        parentOf('ancestor', 'a'),
        parentOf('ancestor', 'b'),
        parentOf('a', 'child'),
        parentOf('b', 'child'),
      ],
    );
    const result = graph.ancestorsOf('child');
    expect(result.implexIds.has('ancestor')).toBe(true);
    // Counted once, not twice: this is what makes ancestor counts truthful.
    expect(result.order.filter((id) => id === 'ancestor')).toHaveLength(1);
  });
});

describe('cycles', () => {
  it('refuses a person as their own parent', () => {
    expect(chain(2).wouldCreateCycle('p0', 'p0')).toBe(true);
  });

  it('refuses an edge that would close a loop', () => {
    const graph = chain(3);
    // p0 is p2's great-grandparent; making p2 the parent of p0 closes a cycle.
    expect(graph.wouldCreateCycle('p2', 'p0')).toBe(true);
  });

  it('allows an edge that does not close a loop', () => {
    const graph = chain(3);
    expect(graph.wouldCreateCycle('p0', 'p2')).toBe(false);
  });

  it('finds no cycles in an acyclic graph', () => {
    expect(chain(6).findCycles()).toEqual([]);
  });

  it('finds a cycle that got into the data anyway', () => {
    // The state an import from weaker software can produce.
    const graph = new GenealogyGraph(
      ['a', 'b', 'c'].map((id) => person(id)),
      [parentOf('a', 'b'), parentOf('b', 'c'), parentOf('c', 'a')],
    );
    const cycles = graph.findCycles();
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]?.length).toBe(3);
  });

  it('terminates on a cyclic graph instead of overflowing the stack', () => {
    const graph = new GenealogyGraph(
      ['a', 'b'].map((id) => person(id)),
      [parentOf('a', 'b'), parentOf('b', 'a')],
    );
    expect(() => graph.ancestorsOf('a')).not.toThrow();
    expect(graph.ancestorsOf('a').depthById.size).toBe(2);
  });

  it('handles a deep chain without recursion limits', () => {
    // 10 000 generations is absurd genealogically and trivial for an explicit
    // stack. A recursive implementation would overflow here.
    const graph = chain(10_000);
    expect(graph.ancestorsOf('p9999').depthById.size).toBe(10_000);
    expect(graph.findCycles()).toEqual([]);
  });
});

describe('relatives', () => {
  it('finds full siblings', () => {
    const graph = new GenealogyGraph(
      ['father', 'mother', 'a', 'b'].map((id) => person(id)),
      [
        parentOf('father', 'a'),
        parentOf('mother', 'a'),
        parentOf('father', 'b'),
        parentOf('mother', 'b'),
      ],
    );
    expect(graph.siblingsOf('a')).toEqual(['b']);
  });

  it('finds half siblings through a shared parent', () => {
    const graph = new GenealogyGraph(
      ['father', 'mother1', 'mother2', 'a', 'b'].map((id) => person(id)),
      [
        parentOf('father', 'a'),
        parentOf('mother1', 'a'),
        parentOf('father', 'b'),
        parentOf('mother2', 'b'),
      ],
    );
    expect(graph.siblingsOf('a')).toEqual(['b']);
  });

  it('never lists a person as their own sibling', () => {
    const graph = new GenealogyGraph(
      ['p', 'c'].map((id) => person(id)),
      [parentOf('p', 'c')],
    );
    expect(graph.siblingsOf('c')).not.toContain('c');
  });
});

describe('components', () => {
  it('reports one component for a connected family', () => {
    expect(chain(5).components()).toHaveLength(1);
  });

  it('reports two components for two unconnected families', () => {
    const graph = new GenealogyGraph(
      ['a1', 'a2', 'b1', 'b2'].map((id) => person(id)),
      [parentOf('a1', 'a2'), parentOf('b1', 'b2')],
    );
    expect(graph.components()).toHaveLength(2);
  });

  it('joins two families through a marriage', () => {
    const graph = new GenealogyGraph(
      ['a1', 'a2', 'b1', 'b2'].map((id) => person(id)),
      [
        parentOf('a1', 'a2'),
        parentOf('b1', 'b2'),
        { id: 'm', sourceId: 'a2', targetId: 'b2', type: 'SPOUSE' },
      ],
    );
    expect(graph.components()).toHaveLength(1);
  });
});

describe('graph invariants hold for arbitrary acyclic graphs', () => {
  /** Generates a random forest: each person may only parent later indices. */
  const arbitraryGraph = fc
    .integer({ min: 2, max: 40 })
    .chain((n) =>
      fc.record({
        n: fc.constant(n),
        links: fc.array(
          fc.tuple(fc.integer({ min: 0, max: n - 2 }), fc.integer({ min: 1, max: n - 1 })),
          { maxLength: n * 2 },
        ),
      }),
    )
    .map(({ n, links }) => {
      const people = Array.from({ length: n }, (_, i) => person(`p${i}`));
      const seen = new Set<string>();
      const edges: GraphEdge[] = [];
      for (const [a, b] of links) {
        // Parent index strictly below child index guarantees acyclicity.
        const [parent, child] = a < b ? [a, b] : [b, a];
        if (parent === child) continue;
        const key = `${parent}->${child}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(parentOf(`p${parent}`, `p${child}`));
      }
      return new GenealogyGraph(people, edges);
    });

  it('never finds a cycle in a graph built to be acyclic', () => {
    fc.assert(
      fc.property(arbitraryGraph, (graph) => {
        expect(graph.findCycles()).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps ancestry and descent mutually consistent', () => {
    fc.assert(
      fc.property(arbitraryGraph, (graph) => {
        for (const id of graph.people.keys()) {
          for (const ancestorId of graph.ancestorsOf(id).depthById.keys()) {
            // If A is an ancestor of B then B is a descendant of A.
            expect(graph.descendantsOf(ancestorId).depthById.has(id)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('never returns a person as their own strict ancestor', () => {
    fc.assert(
      fc.property(arbitraryGraph, (graph) => {
        for (const id of graph.people.keys()) {
          expect(graph.ancestorsOf(id).depthById.get(id)).toBe(0);
          const parents = graph.parentsOf(id).map((e) => e.sourceId);
          expect(parents).not.toContain(id);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('always refuses an edge that would close a cycle', () => {
    fc.assert(
      fc.property(arbitraryGraph, (graph) => {
        for (const id of graph.people.keys()) {
          for (const descendantId of graph.descendantsOf(id).depthById.keys()) {
            if (descendantId === id) continue;
            // Making a descendant into an ancestor must always be refused.
            expect(graph.wouldCreateCycle(descendantId, id)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
