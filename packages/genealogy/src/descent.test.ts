import { describe, expect, it } from 'vitest';
import { GenealogyGraph, abovilleNumbers, type GraphEdge, type GraphPerson } from './index';
import { makeDate } from '@chronolignee/domain';

/**
 * D'Aboville numbering.
 *
 * Sosa cannot get birth order wrong because it never encodes it. This can, and
 * the wrong order produces a descendant study that reads perfectly and lists a
 * family's children in an order no register supports.
 */

let edgeId = 0;
function person(id: string, birthYear?: number): GraphPerson {
  return {
    id,
    displayName: id,
    ...(birthYear === undefined
      ? {}
      : {
          birth: makeDate({
            qualifier: 'EXACT',
            start: { year: birthYear, month: 1, day: 1 },
            originalText: String(birthYear),
          }),
        }),
  };
}

function parent(
  parentId: string,
  childId: string,
  type: GraphEdge['type'] = 'PARENT_BIOLOGICAL',
): GraphEdge {
  edgeId += 1;
  return { id: `e${edgeId}`, sourceId: parentId, targetId: childId, type };
}

describe('numbering a descent', () => {
  it('gives the subject 1 and numbers children in birth order', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1800), person('second', 1832), person('first', 1830), person('third', 1835)],
      [parent('ego', 'second'), parent('ego', 'first'), parent('ego', 'third')],
    );

    const result = abovilleNumbers(graph, 'ego');
    expect(result.numbersById.get('ego')).toEqual(['1']);
    // Birth order, not the order the links happen to be stored in.
    expect(result.numbersById.get('first')).toEqual(['1.1']);
    expect(result.numbersById.get('second')).toEqual(['1.2']);
    expect(result.numbersById.get('third')).toEqual(['1.3']);
  });

  it('extends the number one segment per generation', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1800), person('child', 1830), person('grandchild', 1860)],
      [parent('ego', 'child'), parent('child', 'grandchild')],
    );

    const result = abovilleNumbers(graph, 'ego');
    expect(result.numbersById.get('grandchild')).toEqual(['1.1.1']);
  });

  it('lists the descent depth-first, ready to print', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1800), person('a', 1830), person('a-child', 1860), person('b', 1835)],
      [parent('ego', 'a'), parent('a', 'a-child'), parent('ego', 'b')],
    );

    const result = abovilleNumbers(graph, 'ego');
    // A descendant study is read as an indented list; the order must already
    // be that list, not something the caller has to re-sort.
    expect(result.nodes.map((node) => node.number)).toEqual(['1', '1.1', '1.1.1', '1.2']);
  });

  it('puts an undated child last and says the position is inferred', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1800), person('undated'), person('dated', 1840)],
      [parent('ego', 'undated'), parent('ego', 'dated')],
    );

    const result = abovilleNumbers(graph, 'ego');
    expect(result.numbersById.get('dated')).toEqual(['1.1']);
    expect(result.numbersById.get('undated')).toEqual(['1.2']);

    // The flag is the honest part: d'Aboville numbers birth order, and this
    // child's order is not in the record. Placing them silently would assert
    // something no register says.
    const undated = result.nodes.find((node) => node.personId === 'undated');
    expect(undated?.orderInferred).toBe(true);
    expect(result.nodes.find((node) => node.personId === 'dated')?.orderInferred).toBe(false);
  });

  it('includes an adopted child, unlike Sosa', () => {
    // The two numberings answer different questions: Sosa encodes descent, a
    // descendant study describes a family and its households.
    const graph = new GenealogyGraph(
      [person('ego', 1900), person('adopted', 1930)],
      [parent('ego', 'adopted', 'PARENT_ADOPTIVE')],
    );

    const result = abovilleNumbers(graph, 'ego');
    expect(result.numbersById.get('adopted')).toEqual(['1.1']);

    const biologicalOnly = abovilleNumbers(graph, 'ego', { biologicalOnly: true });
    expect(biologicalOnly.numbersById.has('adopted')).toBe(false);
  });

  it('counts one child once when two links join the same pair', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1900), person('child', 1930)],
      [parent('ego', 'child'), parent('ego', 'child', 'PARENT_ADOPTIVE')],
    );

    const result = abovilleNumbers(graph, 'ego');
    expect(result.numbersById.get('child')).toEqual(['1.1']);
    expect(result.nodes).toHaveLength(2);
  });

  it('gives a descendant reached by two lines both numbers', () => {
    // Cousins marry; their child descends from the subject twice. Two numbers
    // is the truth, and collapsing them would hide the loop.
    const graph = new GenealogyGraph(
      [
        person('ego', 1800),
        person('a', 1830),
        person('b', 1832),
        person('a-child', 1860),
        person('b-child', 1862),
        person('shared', 1890),
      ],
      [
        parent('ego', 'a'),
        parent('ego', 'b'),
        parent('a', 'a-child'),
        parent('b', 'b-child'),
        parent('a-child', 'shared'),
        parent('b-child', 'shared'),
      ],
    );

    const result = abovilleNumbers(graph, 'ego');
    expect(result.numbersById.get('shared')).toEqual(['1.1.1.1', '1.2.1.1']);
  });

  it('counts a doubled descendant once per generation', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1800), person('a', 1830), person('b', 1832), person('shared', 1860)],
      [parent('ego', 'a'), parent('ego', 'b'), parent('a', 'shared'), parent('b', 'shared')],
    );

    const result = abovilleNumbers(graph, 'ego');
    // Two positions, one person. Counting positions would inflate the family.
    expect(result.perGeneration).toEqual([1, 2, 1]);
  });

  it('stops at the requested depth and says so', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1800), person('child', 1830), person('grandchild', 1860)],
      [parent('ego', 'child'), parent('child', 'grandchild')],
    );

    const result = abovilleNumbers(graph, 'ego', { generations: 1 });
    expect(result.truncated).toBe(true);
    expect(result.numbersById.has('grandchild')).toBe(false);
  });

  it('does not claim truncation when the family simply ends', () => {
    const graph = new GenealogyGraph(
      [person('ego', 1800), person('child', 1830)],
      [parent('ego', 'child')],
    );
    expect(abovilleNumbers(graph, 'ego', { generations: 5 }).truncated).toBe(false);
  });

  it('survives a cycle that slipped past validation', () => {
    // Should be impossible: createRelationship refuses it. If one ever exists,
    // a truncated answer beats a blown call stack.
    const graph = new GenealogyGraph(
      [person('a', 1800), person('b', 1830)],
      [parent('a', 'b'), parent('b', 'a')],
    );

    const result = abovilleNumbers(graph, 'a', { generations: 20 });
    expect(result.nodes.length).toBeLessThan(10);
    expect(result.numbersById.has('b')).toBe(true);
  });

  it('answers nothing for someone who is not in the tree', () => {
    const graph = new GenealogyGraph([person('a')], []);
    expect(abovilleNumbers(graph, 'ghost').nodes).toEqual([]);
  });
});
