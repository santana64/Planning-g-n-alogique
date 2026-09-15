import { describe, expect, it } from 'vitest';
import { parseGenealogicalDate } from '@chronolignee/domain';
import { GenealogyGraph, type GraphEdge, type GraphPerson } from './graph.js';
import { hasBlocking, sortBySeverity, type Finding, type FindingCode } from './findings.js';
import { auditPerson, auditTree, validateRelationshipProposal } from './validate.js';

const TODAY = 2_461_299; // 15 September 2026

interface PersonSpec {
  id: string;
  birth?: string;
  death?: string;
  sex?: 'FEMALE' | 'MALE';
}

function person(spec: PersonSpec): GraphPerson & { recordedSex?: string } {
  return {
    id: spec.id,
    displayName: spec.id,
    birth: spec.birth ? parseGenealogicalDate(spec.birth) : null,
    death: spec.death ? parseGenealogicalDate(spec.death) : null,
    ...(spec.sex ? { recordedSex: spec.sex } : {}),
  };
}

function parentOf(parent: string, child: string, type: GraphEdge['type'] = 'PARENT_BIOLOGICAL') {
  return { id: `${parent}->${child}`, sourceId: parent, targetId: child, type };
}

function build(specs: PersonSpec[], edges: GraphEdge[] = []) {
  return new GenealogyGraph(specs.map(person), edges);
}

const codes = (findings: Finding[]): FindingCode[] => findings.map((f) => f.code);
const find = (findings: Finding[], code: FindingCode) => findings.find((f) => f.code === code);

describe('hard invariants block the write', () => {
  it('refuses a self-relationship', () => {
    const graph = build([{ id: 'a' }]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'a',
      targetId: 'a',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(codes(findings)).toContain('SELF_RELATIONSHIP');
    expect(hasBlocking(findings)).toBe(true);
  });

  it('refuses an edge that closes an ancestry cycle', () => {
    const graph = build([{ id: 'a' }, { id: 'b' }], [parentOf('a', 'b')]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'b',
      targetId: 'a',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(codes(findings)).toContain('ANCESTRY_CYCLE');
    expect(hasBlocking(findings)).toBe(true);
  });

  it('refuses a duplicate relationship', () => {
    const graph = build([{ id: 'a' }, { id: 'b' }], [parentOf('a', 'b')]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'a',
      targetId: 'b',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(codes(findings)).toContain('DUPLICATE_RELATIONSHIP');
  });

  it('allows an adoptive parent alongside a biological one', () => {
    const graph = build(
      [{ id: 'bio' }, { id: 'adopt' }, { id: 'child' }],
      [parentOf('bio', 'child', 'PARENT_BIOLOGICAL')],
    );
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'adopt',
      targetId: 'child',
      type: 'PARENT_ADOPTIVE',
    });
    expect(hasBlocking(findings)).toBe(false);
  });

  it('blocks a child born certainly before its parent', () => {
    const graph = build([
      { id: 'parent', birth: '12 JUN 1900' },
      { id: 'child', birth: '12 JUN 1850' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'parent',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    const f = find(findings, 'CHILD_BORN_BEFORE_PARENT');
    expect(f?.severity).toBe('ERROR');
    expect(f?.certainty).toBe('CERTAIN');
  });
});

describe('uncertainty downgrades the same rule to a warning', () => {
  it('blocks when both dates are precise and reversed', () => {
    const graph = build([
      { id: 'parent', birth: '1 JAN 1900' },
      { id: 'child', birth: '1 JAN 1899' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'parent',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(find(findings, 'CHILD_BORN_BEFORE_PARENT')?.severity).toBe('ERROR');
  });

  it('does not block when imprecise dates merely permit the reversal', () => {
    // "About 1900" and "about 1899" overlap. Refusing this would reject
    // perfectly ordinary imprecise data.
    const graph = build([
      { id: 'parent', birth: 'ABT 1900' },
      { id: 'child', birth: 'ABT 1899' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'parent',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(hasBlocking(findings)).toBe(false);
  });

  it('says nothing at all when the parent has no dates', () => {
    const graph = build([{ id: 'parent' }, { id: 'child', birth: '1900' }]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'parent',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(hasBlocking(findings)).toBe(false);
    expect(codes(findings)).not.toContain('PARENT_TOO_YOUNG');
  });
});

describe('research warnings never block', () => {
  it('warns about a very young parent', () => {
    const graph = build([
      { id: 'parent', birth: '1 JAN 1890' },
      { id: 'child', birth: '1 JAN 1900' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'parent',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    const f = find(findings, 'PARENT_TOO_YOUNG');
    expect(f?.severity).toBe('WARNING');
    expect(hasBlocking(findings)).toBe(false);
  });

  it('warns about a mother past the usual bound but accepts the record', () => {
    const graph = build([
      { id: 'mother', birth: '1 JAN 1840', sex: 'FEMALE' },
      { id: 'child', birth: '1 JAN 1900' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'mother',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(find(findings, 'MOTHER_TOO_OLD')?.severity).toBe('WARNING');
    expect(hasBlocking(findings)).toBe(false);
  });

  it('applies the wider paternal bound when sex is unrecorded', () => {
    // A 60-year-old father is unremarkable; a 60-year-old mother is not.
    // Without the recorded sex we must use the bound that warns less.
    const graph = build([
      { id: 'parent', birth: '1 JAN 1840' },
      { id: 'child', birth: '1 JAN 1900' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'parent',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(codes(findings)).not.toContain('MOTHER_TOO_OLD');
    expect(codes(findings)).not.toContain('FATHER_TOO_OLD');
  });

  it('does not apply the age bound to an adoptive parent', () => {
    const graph = build([
      { id: 'parent', birth: '1 JAN 1830', sex: 'FEMALE' },
      { id: 'child', birth: '1 JAN 1900' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'parent',
      targetId: 'child',
      type: 'PARENT_ADOPTIVE',
    });
    expect(codes(findings)).not.toContain('MOTHER_TOO_OLD');
  });
});

describe('posthumous birth', () => {
  it('accepts a child born four months after the father died', () => {
    const graph = build([
      { id: 'father', birth: '1 JAN 1870', death: '1 JAN 1900', sex: 'MALE' },
      { id: 'child', birth: '1 MAY 1900' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'father',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    const f = find(findings, 'POSTHUMOUS_BIRTH');
    expect(f?.severity).toBe('INFO');
    expect(hasBlocking(findings)).toBe(false);
  });

  it('warns when the gap exceeds a gestation', () => {
    const graph = build([
      { id: 'father', birth: '1 JAN 1870', death: '1 JAN 1900', sex: 'MALE' },
      { id: 'child', birth: '1 JUN 1902' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'father',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    expect(codes(findings)).toContain('CHILD_BORN_BEFORE_PARENT');
  });

  it('blocks a birth weeks after the mother died', () => {
    const graph = build([
      { id: 'mother', birth: '1 JAN 1870', death: '1 JAN 1900', sex: 'FEMALE' },
      { id: 'child', birth: '1 MAY 1900' },
    ]);
    const findings = validateRelationshipProposal(graph, {
      sourceId: 'mother',
      targetId: 'child',
      type: 'PARENT_BIOLOGICAL',
    });
    const f = find(findings, 'BIRTH_AFTER_MOTHER_DEATH');
    expect(f?.severity).toBe('ERROR');
  });
});

describe('person audit', () => {
  it('flags a death certainly before a birth', () => {
    const graph = build([{ id: 'a', birth: '1 JAN 1900', death: '1 JAN 1890' }]);
    const findings = auditPerson(graph, 'a', { todayJdn: TODAY });
    expect(find(findings, 'DEATH_BEFORE_BIRTH')?.severity).toBe('ERROR');
  });

  it('flags an implausible lifespan', () => {
    const graph = build([{ id: 'a', birth: '1 JAN 1700', death: '1 JAN 1900' }]);
    const findings = auditPerson(graph, 'a', { todayJdn: TODAY });
    const f = find(findings, 'LIFESPAN_IMPLAUSIBLE');
    expect(f?.severity).toBe('WARNING');
    expect(f?.params?.['years']).toBe(200);
  });

  it('does not flag a long but plausible life', () => {
    const graph = build([{ id: 'a', birth: '21 FEB 1875', death: '4 AUG 1997' }]);
    expect(codes(auditPerson(graph, 'a', { todayJdn: TODAY }))).not.toContain(
      'LIFESPAN_IMPLAUSIBLE',
    );
  });

  it('notes a person with no temporal evidence', () => {
    const graph = build([{ id: 'a' }]);
    const f = find(auditPerson(graph, 'a', { todayJdn: TODAY }), 'NO_TEMPORAL_EVIDENCE');
    expect(f?.severity).toBe('INFO');
  });

  it('flags siblings born impossibly close together', () => {
    const graph = build(
      [
        { id: 'mother', birth: '1 JAN 1870', sex: 'FEMALE' },
        { id: 'a', birth: '1 JAN 1900' },
        { id: 'b', birth: '1 MAR 1900' },
      ],
      [parentOf('mother', 'a'), parentOf('mother', 'b')],
    );
    expect(codes(auditPerson(graph, 'a', { todayJdn: TODAY }))).toContain(
      'SIBLINGS_BORN_TOO_CLOSE',
    );
  });

  it('does not flag twins', () => {
    const graph = build(
      [
        { id: 'mother', birth: '1 JAN 1870', sex: 'FEMALE' },
        { id: 'a', birth: '1 JAN 1900' },
        { id: 'b', birth: '1 JAN 1900' },
      ],
      [parentOf('mother', 'a'), parentOf('mother', 'b')],
    );
    expect(codes(auditPerson(graph, 'a', { todayJdn: TODAY }))).not.toContain(
      'SIBLINGS_BORN_TOO_CLOSE',
    );
  });
});

describe('tree audit', () => {
  it('reports a cycle that got into the data', () => {
    const graph = build([{ id: 'a' }, { id: 'b' }], [parentOf('a', 'b'), parentOf('b', 'a')]);
    expect(codes(auditTree(graph, { todayJdn: TODAY }))).toContain('ANCESTRY_CYCLE');
  });

  it('reports unconnected families', () => {
    const graph = build(
      [{ id: 'a1' }, { id: 'a2' }, { id: 'b1' }, { id: 'b2' }],
      [parentOf('a1', 'a2'), parentOf('b1', 'b2')],
    );
    const disconnected = auditTree(graph, { todayJdn: TODAY }).filter(
      (f) => f.code === 'DISCONNECTED_COMPONENT',
    );
    // One report for the smaller family, none for the main one.
    expect(disconnected).toHaveLength(1);
  });

  it('reports a shared parent/child problem once, not twice', () => {
    const graph = build(
      [
        { id: 'parent', birth: '1 JAN 1890' },
        { id: 'child', birth: '1 JAN 1900' },
      ],
      [parentOf('parent', 'child')],
    );
    const tooYoung = auditTree(graph, { todayJdn: TODAY }).filter(
      (f) => f.code === 'PARENT_TOO_YOUNG',
    );
    expect(tooYoung).toHaveLength(1);
  });

  it('orders findings by severity, then certainty', () => {
    const findings = sortBySeverity([
      { code: 'NO_TEMPORAL_EVIDENCE', severity: 'INFO', certainty: 'CERTAIN', entities: [] },
      { code: 'PARENT_TOO_YOUNG', severity: 'WARNING', certainty: 'POSSIBLE', entities: [] },
      { code: 'DEATH_BEFORE_BIRTH', severity: 'ERROR', certainty: 'CERTAIN', entities: [] },
      { code: 'MOTHER_TOO_OLD', severity: 'WARNING', certainty: 'CERTAIN', entities: [] },
    ]);
    expect(codes(findings)).toEqual([
      'DEATH_BEFORE_BIRTH',
      'MOTHER_TOO_OLD',
      'PARENT_TOO_YOUNG',
      'NO_TEMPORAL_EVIDENCE',
    ]);
  });
});
