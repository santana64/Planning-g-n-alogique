import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  layoutConstellation,
  type ConstellationLinkInput,
  type ConstellationPersonInput,
} from './constellation';

/**
 * The constellation layout.
 *
 * What is asserted is what a reader relies on: the same family lands in the
 * same place every time, parents above and children below, and nobody's
 * position is decided by a date the viewer is not allowed to know.
 */

function people(...ids: string[]): ConstellationPersonInput[] {
  return ids.map((id, index) => ({ id, birthSortJdn: 2_400_000 + index * 1000 }));
}

const parent = (from: string, to: string): ConstellationLinkInput => ({ from, to, kind: 'PARENT' });
const partners = (from: string, to: string): ConstellationLinkInput => ({
  from,
  to,
  kind: 'PARTNER',
});

// A small family: focus F, parents P1 P2, grandparents G1 G2 (of P1),
// partner S, children C1 C2, grandchild K (of C1), sibling B.
const FAMILY = {
  people: people('G1', 'G2', 'P1', 'P2', 'F', 'B', 'S', 'C1', 'C2', 'K'),
  links: [
    parent('G1', 'P1'),
    parent('G2', 'P1'),
    parent('P1', 'F'),
    parent('P2', 'F'),
    parent('P1', 'B'),
    parent('P2', 'B'),
    partners('F', 'S'),
    parent('F', 'C1'),
    parent('S', 'C1'),
    parent('F', 'C2'),
    parent('C1', 'K'),
  ],
};

function node(layout: ReturnType<typeof layoutConstellation>, id: string) {
  const found = layout.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`${id} not in layout`);
  return found;
}

describe('distance and generation', () => {
  it('puts the focus at the centre and everyone else on the ring of their hop', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, { maxHops: 4 });
    expect(node(layout, 'F')).toMatchObject({ hop: 0, x: 0, y: 0 });
    for (const current of layout.nodes) {
      expect(Math.hypot(current.x, current.y)).toBeCloseTo(current.hop * 10, 6);
    }
    expect(node(layout, 'P1').hop).toBe(1);
    expect(node(layout, 'G1').hop).toBe(2);
    expect(node(layout, 'K').hop).toBe(2);
  });

  it('counts generations up and down, siblings level with the focus', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, { maxHops: 4 });
    expect(node(layout, 'G1').generation).toBe(2);
    expect(node(layout, 'P2').generation).toBe(1);
    expect(node(layout, 'S').generation).toBe(0);
    expect(node(layout, 'B').generation).toBe(0);
    expect(node(layout, 'K').generation).toBe(-2);
  });

  it('stops at the hop limit and says so', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, { maxHops: 1 });
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['C1', 'C2', 'F', 'P1', 'P2', 'S']);
    expect(layout.truncated).toBe(true);
    expect(layout.maxHop).toBe(1);
  });

  it('does not claim to have left anyone out when nobody is left', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, { maxHops: 10 });
    expect(layout.nodes).toHaveLength(FAMILY.people.length);
    expect(layout.truncated).toBe(false);
  });

  it('honours a ceiling on the number of people', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, {
      maxHops: 10,
      maxPeople: 4,
    });
    expect(layout.nodes).toHaveLength(4);
    expect(layout.truncated).toBe(true);
  });
});

describe('orientation', () => {
  it('turns the parents to the top and the children to the bottom', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, { maxHops: 4 });
    // y grows upward here, as in the scene the layout feeds.
    expect(node(layout, 'P1').y).toBeGreaterThan(0);
    expect(node(layout, 'P2').y).toBeGreaterThan(0);
    expect(node(layout, 'C1').y).toBeLessThan(0);
    expect(node(layout, 'C2').y).toBeLessThan(0);
  });

  it('puts an only child straight below when no parent is recorded', () => {
    const layout = layoutConstellation('P', people('P', 'C'), [parent('P', 'C')], {
      maxHops: 1,
    });
    expect(node(layout, 'C').x).toBeCloseTo(0, 6);
    expect(node(layout, 'C').y).toBeCloseTo(-10, 6);
  });

  it('puts the father on the left and the mother on the right, as Sosa does', () => {
    const layout = layoutConstellation(
      'F',
      [
        { id: 'F', birthSortJdn: 3000 },
        // The mother is the elder: sex decides the side, not age.
        { id: 'mother', birthSortJdn: 1000, recordedSex: 'FEMALE' },
        { id: 'father', birthSortJdn: 2000, recordedSex: 'MALE' },
      ],
      [parent('mother', 'F'), parent('father', 'F')],
      { maxHops: 1 },
    );
    expect(node(layout, 'father').x).toBeLessThan(0);
    expect(node(layout, 'mother').x).toBeGreaterThan(0);
  });

  it('reads siblings left to right by birth, with the undated last', () => {
    const layout = layoutConstellation(
      'P',
      [
        { id: 'P', birthSortJdn: 1 },
        { id: 'late', birthSortJdn: 3000 },
        { id: 'undated', birthSortJdn: null },
        { id: 'early', birthSortJdn: 2000 },
      ],
      [parent('P', 'late'), parent('P', 'undated'), parent('P', 'early')],
      { maxHops: 1 },
    );
    const leftToRight = [...layout.nodes]
      .filter((n) => n.hop === 1)
      .sort((a, b) => a.x - b.x)
      .map((n) => n.id);
    expect(leftToRight).toEqual(['early', 'late', 'undated']);
  });
});

describe('room', () => {
  it('gives a branch room in proportion to the people reached through it', () => {
    // Two children; one has four children of their own, the other none.
    const layout = layoutConstellation(
      'P',
      people('P', 'big', 'small', 'a', 'b', 'c', 'd'),
      [
        parent('P', 'big'),
        parent('P', 'small'),
        parent('big', 'a'),
        parent('big', 'b'),
        parent('big', 'c'),
        parent('big', 'd'),
      ],
      { maxHops: 2 },
    );
    const grandchildren = layout.nodes.filter((n) => n.hop === 2).map((n) => n.angle);
    const spread = Math.max(...grandchildren) - Math.min(...grandchildren);
    // Four of the five leaves come through "big": most of the circle.
    expect(spread).toBeGreaterThan(Math.PI);
  });
});

describe('links', () => {
  it('keeps every relationship between two people shown, not only the walk', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, { maxHops: 4 });
    // S is reached as F's partner; S's link to C1 was never walked, and it is
    // still a line the reader must see.
    expect(layout.links).toContainEqual(parent('S', 'C1'));
  });

  it('drops links to people outside the result', () => {
    const layout = layoutConstellation('F', FAMILY.people, FAMILY.links, { maxHops: 1 });
    expect(layout.links.some((link) => link.from === 'G1' || link.to === 'K')).toBe(false);
  });

  it('draws a partnership once, whichever way it was recorded', () => {
    const layout = layoutConstellation(
      'A',
      people('A', 'B'),
      [partners('A', 'B'), partners('B', 'A')],
      { maxHops: 1 },
    );
    expect(layout.links).toHaveLength(1);
  });

  it('shows a pedigree loop as a loop', () => {
    // Cousins who married: their child descends from G by two lines.
    const layout = layoutConstellation(
      'X',
      people('G', 'A', 'B', 'M', 'N', 'X'),
      [
        parent('G', 'A'),
        parent('G', 'B'),
        parent('A', 'M'),
        parent('B', 'N'),
        parent('M', 'X'),
        parent('N', 'X'),
      ],
      { maxHops: 6 },
    );
    expect(layout.nodes.filter((n) => n.id === 'G')).toHaveLength(1);
    expect(layout.links.filter((link) => link.from === 'G')).toHaveLength(2);
  });
});

describe('unknown focus', () => {
  it('returns nothing rather than inventing a centre', () => {
    const layout = layoutConstellation('nobody', FAMILY.people, FAMILY.links, { maxHops: 3 });
    expect(layout.nodes).toEqual([]);
  });
});

describe('properties', () => {
  const graph = fc.integer({ min: 1, max: 40 }).chain((count) =>
    fc.record({
      count: fc.constant(count),
      links: fc.array(
        fc.record({
          from: fc.integer({ min: 0, max: count - 1 }),
          to: fc.integer({ min: 0, max: count - 1 }),
          kind: fc.constantFrom('PARENT' as const, 'PARTNER' as const),
        }),
        { maxLength: count * 2 },
      ),
      order: fc.shuffledSubarray([...Array(count).keys()], { minLength: count }),
    }),
  );

  it('is the same picture whatever order the records arrive in', () => {
    fc.assert(
      fc.property(graph, ({ count, links, order }) => {
        const input = [...Array(count).keys()].map((index) => ({
          id: `p${index}`,
          birthSortJdn: index % 3 === 0 ? null : index * 100,
        }));
        const edges = links.map((link) => ({
          from: `p${link.from}`,
          to: `p${link.to}`,
          kind: link.kind,
        }));
        const a = layoutConstellation('p0', input, edges, { maxHops: 5 });
        const b = layoutConstellation(
          'p0',
          order.map((index) => input[index] as ConstellationPersonInput),
          [...edges].reverse(),
          { maxHops: 5 },
        );
        const positions = (layout: typeof a) =>
          Object.fromEntries(layout.nodes.map((n) => [n.id, [n.x.toFixed(6), n.y.toFixed(6)]]));
        expect(positions(b)).toEqual(positions(a));
      }),
      { numRuns: 150 },
    );
  });

  it('never puts two people of the same ring at the same angle', () => {
    fc.assert(
      fc.property(graph, ({ count, links }) => {
        const input = [...Array(count).keys()].map((index) => ({
          id: `p${index}`,
          birthSortJdn: index * 100,
        }));
        const layout = layoutConstellation(
          'p0',
          input,
          links.map((link) => ({ from: `p${link.from}`, to: `p${link.to}`, kind: link.kind })),
          { maxHops: 6 },
        );
        const seen = new Set<string>();
        for (const current of layout.nodes) {
          if (current.hop === 0) continue;
          const key = `${current.hop}:${current.angle.toFixed(9)}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }),
      { numRuns: 150 },
    );
  });
});
