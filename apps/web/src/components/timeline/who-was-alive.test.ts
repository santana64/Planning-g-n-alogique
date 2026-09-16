import { describe, expect, it } from 'vitest';
import { gregorianToJdn } from '@chronolignee/domain';
import { stateAt, whoWasAlive } from './who-was-alive';
import type { TimelineRow } from '@/server/timeline';

const y = (year: number, month = 1, day = 1) => gregorianToJdn(year, month, day);
const VE_DAY = y(1945, 5, 8);
const TODAY = y(2026, 9, 16);

function row(overrides: Partial<TimelineRow>): TimelineRow {
  return {
    personId: overrides.personId ?? 'p',
    displayName: 'Test',
    row: 0,
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
    ...overrides,
  };
}

/** A person with exactly known birth and death. */
function exact(birthYear: number, deathYear: number): TimelineRow {
  return row({
    birthEarliestJdn: y(birthYear),
    birthLatestJdn: y(birthYear),
    deathEarliestJdn: y(deathYear),
    deathLatestJdn: y(deathYear),
  });
}

describe('state at a moment', () => {
  it('is certain when both ends bracket the day', () => {
    expect(stateAt(exact(1900, 1980), VE_DAY, TODAY)).toBe('ALIVE_CERTAIN');
  });

  it('distinguishes not-yet-born from already-dead', () => {
    // Both are "NO", but on a timeline the direction of time is the point:
    // one should fade in ahead of the cursor, the other recede behind it.
    expect(stateAt(exact(1960, 2010), VE_DAY, TODAY)).toBe('UNBORN');
    expect(stateAt(exact(1820, 1890), VE_DAY, TODAY)).toBe('DECEASED');
  });

  it('is possible when the death is unrecorded but the lifespan allows it', () => {
    // Henriette's case: born 1887, no death anywhere. Certainly born by 1945;
    // not certainly still alive. MAYBE is the only honest answer.
    const henriette = row({ birthEarliestJdn: y(1887), birthLatestJdn: y(1887) });
    expect(stateAt(henriette, VE_DAY, TODAY)).toBe('ALIVE_POSSIBLE');
  });

  it('rules out an eighteenth-century birth by the maximum-lifespan rule', () => {
    const mathurin = row({ birthEarliestJdn: y(1702), birthLatestJdn: y(1702) });
    expect(stateAt(mathurin, VE_DAY, TODAY)).toBe('DECEASED');
  });

  it('is possible when an approximate birth straddles the day', () => {
    const straddling = row({
      birthEarliestJdn: y(1940),
      birthLatestJdn: y(1950),
      deathEarliestJdn: y(2000),
      deathLatestJdn: y(2000),
    });
    expect(stateAt(straddling, VE_DAY, TODAY)).toBe('ALIVE_POSSIBLE');
  });

  it('reports a person with no dates as undated, never as absent', () => {
    expect(stateAt(row({}), VE_DAY, TODAY)).toBe('UNDATED');
  });

  it('never asks the question about a redacted person', () => {
    // Their bounds are already null, but the flag is what guarantees the
    // answer is HIDDEN rather than the indistinguishable UNDATED.
    expect(stateAt(row({ redacted: true }), VE_DAY, TODAY)).toBe('HIDDEN');
  });

  it('counts a living person as certainly alive once born', () => {
    const living = row({ birthEarliestJdn: y(1930), birthLatestJdn: y(1930), isLiving: true });
    expect(stateAt(living, VE_DAY, TODAY)).toBe('ALIVE_CERTAIN');
  });
});

describe('the three groups are never merged', () => {
  const rows: TimelineRow[] = [
    exact(1900, 1980),
    exact(1910, 1990),
    exact(1820, 1890),
    exact(1960, 2010),
    row({ birthEarliestJdn: y(1887), birthLatestJdn: y(1887) }),
    row({}),
    row({ redacted: true }),
  ];

  it('separates certain, possible and undated', () => {
    const alive = whoWasAlive(rows, VE_DAY, TODAY);
    expect(alive.certain).toBe(2);
    expect(alive.possible).toBe(1);
    expect(alive.undated).toBe(1);
    expect(alive.deceased).toBe(1);
    expect(alive.unborn).toBe(1);
    expect(alive.hidden).toBe(1);
  });

  it('accounts for every row exactly once', () => {
    const alive = whoWasAlive(rows, VE_DAY, TODAY);
    const total =
      alive.certain + alive.possible + alive.undated + alive.deceased + alive.unborn + alive.hidden;
    expect(total).toBe(rows.length);
  });

  it('writes one state code per row', () => {
    expect(whoWasAlive(rows, VE_DAY, TODAY).states).toHaveLength(rows.length);
  });

  it('reuses the buffer it is handed, so dragging allocates nothing', () => {
    const buffer = new Uint8Array(rows.length);
    const alive = whoWasAlive(rows, VE_DAY, TODAY, buffer);
    expect(alive.states).toBe(buffer);
  });

  it('allocates a fresh buffer when the one offered is the wrong size', () => {
    const wrongSize = new Uint8Array(2);
    expect(whoWasAlive(rows, VE_DAY, TODAY, wrongSize).states).not.toBe(wrongSize);
  });

  it('never claims certainty it did not have a moment earlier', () => {
    // Walking the cursor forward, a person goes UNBORN -> alive -> DECEASED
    // and never returns. A state machine that flickers would mean the
    // underlying comparison is wrong.
    const person = exact(1900, 1980);
    const seen: string[] = [];
    for (let year = 1850; year <= 2020; year += 5) {
      const state = stateAt(person, y(year), TODAY);
      if (seen[seen.length - 1] !== state) seen.push(state);
    }
    expect(seen).toEqual(['UNBORN', 'ALIVE_CERTAIN', 'DECEASED']);
  });
});
