import { describe, expect, it } from 'vitest';
import type { GanttLink } from '@chronolignee/engine';
import type { TimelineRow } from '@/server/timeline';
import { familyOf } from './family';
import { rowColour, type TimelineTheme } from './render-timeline';

function row(index: number, overrides: Partial<TimelineRow> = {}): TimelineRow {
  return {
    personId: `p${index}`,
    displayName: `Person ${index}`,
    row: index,
    depth: 0,
    branchKey: 'b',
    earliestJdn: null,
    latestJdn: null,
    birthEarliestJdn: null,
    birthLatestJdn: null,
    deathEarliestJdn: null,
    deathLatestJdn: null,
    startCertainty: 'UNKNOWN',
    endCertainty: 'UNKNOWN',
    isLiving: false,
    birthLabel: '—',
    deathLabel: '—',
    lifespanLabel: '',
    redacted: false,
    sex: 'UNKNOWN',
    ...overrides,
  };
}

const parent = (id: string, fromRow: number, toRow: number): GanttLink => ({
  id,
  fromRow,
  toRow,
  jdn: 2_400_000,
  kind: 'PARENT',
});

describe('familyOf', () => {
  // Rows: 0 father, 1 mother, 2 younger child, 3 elder child.
  const rows = [
    row(0, { sex: 'MALE' }),
    row(1, { sex: 'FEMALE' }),
    row(2, { birthEarliestJdn: 2_400_900 }),
    row(3, { birthEarliestJdn: 2_400_100 }),
  ];
  const links: GanttLink[] = [
    parent('a', 0, 2),
    parent('b', 1, 2),
    parent('c', 0, 3),
    parent('d', 1, 3),
    { id: 'm', fromRow: 0, toRow: 1, jdn: 2_399_000, kind: 'PARTNER' },
  ];
  const family = familyOf({ rows, links });

  it('names the mother before the father, whatever order the links came in', () => {
    expect(family.parents.get(2)).toEqual([1, 0]);
  });

  it('lists children in birth order', () => {
    expect(family.children.get(0)).toEqual([3, 2]);
    expect(family.children.get(1)).toEqual([3, 2]);
  });

  it('records a union on both sides', () => {
    expect(family.partners.get(0)).toEqual([1]);
    expect(family.partners.get(1)).toEqual([0]);
  });

  it('counts a parent once even when two links say the same thing', () => {
    const twice = familyOf({ rows, links: [parent('a', 0, 2), parent('a2', 0, 2)] });
    expect(twice.parents.get(2)).toEqual([0]);
  });

  it('knows nothing the links did not say', () => {
    // A protected relative's link is dropped on the server; the family built
    // here must not reintroduce them.
    expect(familyOf({ rows, links: [] }).parents.size).toBe(0);
  });
});

describe('rowColour', () => {
  const theme = {
    sexFemale: 'pink',
    sexMale: 'blue',
    sexOther: 'violet',
    sexUnknown: 'grey',
  } as TimelineTheme;

  it('reads pink for women, blue for men, grey when not recorded', () => {
    expect(rowColour(row(0, { sex: 'FEMALE' }), theme, 'SEX')).toBe('pink');
    expect(rowColour(row(0, { sex: 'MALE' }), theme, 'SEX')).toBe('blue');
    expect(rowColour(row(0, { sex: 'OTHER' }), theme, 'SEX')).toBe('violet');
    expect(rowColour(row(0), theme, 'SEX')).toBe('grey');
  });

  it('ignores sex entirely when colouring by branch', () => {
    const a = rowColour(row(0, { sex: 'FEMALE', branchKey: 'x' }), theme, 'BRANCH');
    const b = rowColour(row(0, { sex: 'MALE', branchKey: 'x' }), theme, 'BRANCH');
    expect(a).toBe(b);
    expect(a).toMatch(/^oklch\(/);
  });
});
