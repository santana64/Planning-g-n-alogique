import { describe, expect, it } from 'vitest';
import {
  GenealogyGraph,
  MAX_EXACT_SOSA_GENERATION,
  kinship,
  pedigreeCompleteness,
  sosaNumbers,
  type GraphEdge,
  type GraphPerson,
} from './index';

/**
 * Sosa numbering and kinship.
 *
 * Both are the kind of arithmetic that looks right and is not: an off-by-one
 * in cousin degree turns a first cousin into a sibling, and a Sosa number
 * assigned to the wrong slot swaps a family's paternal and maternal lines
 * without ever looking wrong on screen.
 */

function person(id: string, sex: GraphPerson['recordedSex'] = 'UNKNOWN'): GraphPerson {
  return { id, displayName: id, recordedSex: sex };
}

let edgeId = 0;
function parent(parentId: string, childId: string): GraphEdge {
  edgeId += 1;
  return {
    id: `e${edgeId}`,
    sourceId: parentId,
    targetId: childId,
    type: 'PARENT_BIOLOGICAL',
  };
}

function partner(a: string, b: string): GraphEdge {
  edgeId += 1;
  return { id: `e${edgeId}`, sourceId: a, targetId: b, type: 'SPOUSE' };
}

/**
 * Three complete generations.
 *
 *            ego
 *        /         \
 *     father      mother
 *     /    \      /     \
 *   ff     fm    mf     mm
 */
function threeGenerations(): GenealogyGraph {
  return new GenealogyGraph(
    [
      person('ego'),
      person('father', 'MALE'),
      person('mother', 'FEMALE'),
      person('ff', 'MALE'),
      person('fm', 'FEMALE'),
      person('mf', 'MALE'),
      person('mm', 'FEMALE'),
    ],
    [
      parent('father', 'ego'),
      parent('mother', 'ego'),
      parent('ff', 'father'),
      parent('fm', 'father'),
      parent('mf', 'mother'),
      parent('mm', 'mother'),
    ],
  );
}

describe('Sosa-Stradonitz numbering', () => {
  it('gives the subject 1, the father 2 and the mother 3', () => {
    const result = sosaNumbers(threeGenerations(), 'ego');
    expect(result.numbersById.get('ego')).toEqual([1]);
    expect(result.numbersById.get('father')).toEqual([2]);
    expect(result.numbersById.get('mother')).toEqual([3]);
  });

  it('doubles at every generation', () => {
    const result = sosaNumbers(threeGenerations(), 'ego');
    // The paternal grandfather of a subject numbered 1 is 4, his wife 5.
    expect(result.numbersById.get('ff')).toEqual([4]);
    expect(result.numbersById.get('fm')).toEqual([5]);
    expect(result.numbersById.get('mf')).toEqual([6]);
    expect(result.numbersById.get('mm')).toEqual([7]);
  });

  it('places the father on the even number even when entered second', () => {
    // Recorded sex decides the slot, not the order the edges happen to be in.
    const graph = new GenealogyGraph(
      [person('ego'), person('mother', 'FEMALE'), person('father', 'MALE')],
      [parent('mother', 'ego'), parent('father', 'ego')],
    );
    const result = sosaNumbers(graph, 'ego');
    expect(result.numbersById.get('father')).toEqual([2]);
    expect(result.numbersById.get('mother')).toEqual([3]);
  });

  it('gives a doubled ancestor every number they occupy', () => {
    // Pedigree collapse: the subject's parents are first cousins, so one
    // couple stands in two places. Deduplicating to one number would erase
    // the phenomenon the numbering exists to expose.
    const graph = new GenealogyGraph(
      [
        person('ego'),
        person('father', 'MALE'),
        person('mother', 'FEMALE'),
        person('ff', 'MALE'),
        person('mf', 'MALE'),
        person('shared-gf', 'MALE'),
        person('shared-gm', 'FEMALE'),
      ],
      [
        parent('father', 'ego'),
        parent('mother', 'ego'),
        parent('ff', 'father'),
        parent('mf', 'mother'),
        parent('shared-gf', 'ff'),
        parent('shared-gm', 'ff'),
        parent('shared-gf', 'mf'),
        parent('shared-gm', 'mf'),
      ],
    );

    const result = sosaNumbers(graph, 'ego');
    // ff is 4, mf is 6; their shared father is therefore 8 and 12.
    expect(result.numbersById.get('shared-gf')).toEqual([8, 12]);
    expect(result.numbersById.get('shared-gm')).toEqual([9, 13]);
  });

  it('says so when it stopped at the requested depth', () => {
    const result = sosaNumbers(threeGenerations(), 'ego', { generations: 1 });
    expect(result.truncated).toBe(true);
    expect(result.numbersById.has('ff')).toBe(false);
  });

  it('does not claim truncation when it reached the top', () => {
    const result = sosaNumbers(threeGenerations(), 'ego', { generations: 5 });
    expect(result.truncated).toBe(false);
    expect(result.generationsReached).toBe(2);
  });

  it('refuses to emit numbers it cannot represent exactly', () => {
    const result = sosaNumbers(threeGenerations(), 'ego', {
      generations: MAX_EXACT_SOSA_GENERATION + 10,
    });
    // Nothing here is that deep, but the flag has to tell the caller that the
    // request exceeded what integer arithmetic can express.
    expect(result.precisionLimited).toBe(true);
  });

  it('follows biological parentage only, by default', () => {
    const graph = new GenealogyGraph(
      [person('ego'), person('birth-father', 'MALE'), person('adoptive-father', 'MALE')],
      [
        parent('birth-father', 'ego'),
        { id: 'a1', sourceId: 'adoptive-father', targetId: 'ego', type: 'PARENT_ADOPTIVE' },
      ],
    );

    const result = sosaNumbers(graph, 'ego');
    expect(result.numbersById.get('birth-father')).toEqual([2]);
    // Not a lesser father — a different kind of fact. Sosa encodes descent.
    expect(result.numbersById.has('adoptive-father')).toBe(false);
  });
});

describe('pedigree completeness', () => {
  it('counts what each generation could hold against what it holds', () => {
    const rows = pedigreeCompleteness(sosaNumbers(threeGenerations(), 'ego'));
    expect(rows).toEqual([
      { generation: 0, possible: 1, known: 1, filledPositions: 1 },
      { generation: 1, possible: 2, known: 2, filledPositions: 2 },
      { generation: 2, possible: 4, known: 4, filledPositions: 4 },
    ]);
  });

  it('reports the empty generation when asked to look one deeper', () => {
    // What a pedigree screen needs in order to show where the work stops.
    const rows = pedigreeCompleteness(sosaNumbers(threeGenerations(), 'ego'), 3);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toEqual({ generation: 3, possible: 8, known: 0, filledPositions: 0 });
  });

  it('counts people, not slots, so collapse does not flatter the research', () => {
    const graph = new GenealogyGraph(
      [
        person('ego'),
        person('father', 'MALE'),
        person('mother', 'FEMALE'),
        person('gf', 'MALE'),
        person('gm', 'FEMALE'),
      ],
      [
        parent('father', 'ego'),
        parent('mother', 'ego'),
        // Both parents share one couple: an impossible family, but exactly
        // the arithmetic a real collapse produces.
        parent('gf', 'father'),
        parent('gm', 'father'),
        parent('gf', 'mother'),
        parent('gm', 'mother'),
      ],
    );

    const rows = pedigreeCompleteness(sosaNumbers(graph, 'ego'));
    const second = rows.find((row) => row.generation === 2);
    expect(second?.filledPositions).toBe(4);
    // Four slots, two people. Reporting four would claim twice the research.
    expect(second?.known).toBe(2);
  });
});

describe('kinship', () => {
  const graph = threeGenerations();

  it('recognises the person themselves', () => {
    expect(kinship(graph, 'ego', 'ego').code).toBe('SELF');
  });

  it('names a direct ancestor and how far up', () => {
    const result = kinship(graph, 'ego', 'ff');
    expect(result.code).toBe('DESCENDANT');
    expect(result.up).toBe(2);
  });

  it('names a direct descendant from the other side', () => {
    const result = kinship(graph, 'ff', 'ego');
    expect(result.code).toBe('ANCESTOR');
    expect(result.down).toBe(2);
  });

  it('finds siblings through their shared parents', () => {
    const siblings = new GenealogyGraph(
      [person('a'), person('b'), person('p', 'MALE'), person('q', 'FEMALE')],
      [parent('p', 'a'), parent('q', 'a'), parent('p', 'b'), parent('q', 'b')],
    );
    const result = kinship(siblings, 'a', 'b');
    expect(result.code).toBe('SIBLING');
    // Both parents, not just whichever was reached first.
    expect([...result.through].sort()).toEqual(['p', 'q']);
  });

  it('calls a first cousin a cousin of degree one, not a sibling', () => {
    // The off-by-one that matters: up = down = 2, so degree is 1.
    const cousins = new GenealogyGraph(
      [person('a'), person('b'), person('a-parent'), person('b-parent'), person('gf', 'MALE')],
      [
        parent('a-parent', 'a'),
        parent('b-parent', 'b'),
        parent('gf', 'a-parent'),
        parent('gf', 'b-parent'),
      ],
    );

    const result = kinship(cousins, 'a', 'b');
    expect(result.code).toBe('COUSIN');
    expect(result.degree).toBe(1);
    expect(result.removal).toBe(0);
  });

  it('measures removal when the two are not on the same level', () => {
    const graph2 = new GenealogyGraph(
      [
        person('a'),
        person('child-of-b'),
        person('b'),
        person('a-parent'),
        person('b-parent'),
        person('gf', 'MALE'),
      ],
      [
        parent('a-parent', 'a'),
        parent('b-parent', 'b'),
        parent('gf', 'a-parent'),
        parent('gf', 'b-parent'),
        parent('b', 'child-of-b'),
      ],
    );

    const result = kinship(graph2, 'a', 'child-of-b');
    expect(result.code).toBe('COUSIN');
    // Cousin once removed: still first cousins' line, one generation apart.
    expect(result.degree).toBe(1);
    expect(result.removal).toBe(1);
  });

  it('names an aunt or uncle rather than calling them a cousin', () => {
    const graph3 = new GenealogyGraph(
      [person('ego'), person('parent'), person('pibling'), person('gf', 'MALE')],
      [parent('parent', 'ego'), parent('gf', 'parent'), parent('gf', 'pibling')],
    );
    const result = kinship(graph3, 'ego', 'pibling');
    expect(result.code).toBe('PIBLING');
    expect(result.up).toBe(2);
    expect(result.down).toBe(1);
  });

  it('answers the same relation from the other end', () => {
    const graph4 = new GenealogyGraph(
      [person('ego'), person('parent'), person('pibling'), person('gf', 'MALE')],
      [parent('parent', 'ego'), parent('gf', 'parent'), parent('gf', 'pibling')],
    );
    const result = kinship(graph4, 'pibling', 'ego');
    expect(result.code).toBe('NIBLING');
  });

  it('calls a spouse a spouse rather than unrelated', () => {
    const married = new GenealogyGraph([person('a'), person('b')], [partner('a', 'b')]);
    // True and useless is not an acceptable answer for the person someone
    // spent their life with.
    expect(kinship(married, 'a', 'b').code).toBe('PARTNER');
  });

  it('says unrelated when there is genuinely nothing', () => {
    const strangers = new GenealogyGraph([person('a'), person('b')], []);
    expect(kinship(strangers, 'a', 'b').code).toBe('UNRELATED');
  });

  it('takes the nearest common ancestor, not any of them', () => {
    // Two people related both as first cousins and, further up, through an
    // older shared couple. The useful answer is the close one.
    const graph5 = new GenealogyGraph(
      [
        person('a'),
        person('b'),
        person('a-parent'),
        person('b-parent'),
        person('near', 'MALE'),
        person('far', 'MALE'),
      ],
      [
        parent('a-parent', 'a'),
        parent('b-parent', 'b'),
        parent('near', 'a-parent'),
        parent('near', 'b-parent'),
        parent('far', 'near'),
      ],
    );

    const result = kinship(graph5, 'a', 'b');
    expect(result.through).toEqual(['near']);
  });
});
