import { wasAliveOnIntervals } from '@chronolignee/domain';
import type { TimelineRow } from '@/server/timeline';

/**
 * Who was alive on a given day.
 *
 * Computed on the client, on every frame of a cursor drag. The snapshot
 * already carries the four bounds each answer needs, so the question never
 * leaves the browser — dragging a year across three centuries should feel like
 * moving a slider, not like querying a database three hundred times.
 *
 * The output keeps three groups apart and never merges them. "42 people were
 * alive" is a claim the evidence usually cannot support; "42 certainly, 7
 * possibly, 12 with no dates at all" is what the records actually say, and the
 * third group is the one that tells a researcher where to look next.
 */

export const ALIVE_STATES = [
  /** Not yet born on this day. */
  'UNBORN',
  /** Certainly alive: birth is certainly past and death certainly not yet. */
  'ALIVE_CERTAIN',
  /** Compatible with the records, but the uncertainty forbids the claim. */
  'ALIVE_POSSIBLE',
  /** Certainly dead by this day. */
  'DECEASED',
  /** No temporal evidence at all, so the question cannot be asked. */
  'UNDATED',
  /** Redacted for this viewer; the question is not asked on their behalf. */
  'HIDDEN',
] as const;

export type AliveState = (typeof ALIVE_STATES)[number];

const STATE_CODE: Record<AliveState, number> = {
  UNBORN: 0,
  ALIVE_CERTAIN: 1,
  ALIVE_POSSIBLE: 2,
  DECEASED: 3,
  UNDATED: 4,
  HIDDEN: 5,
};

const CODE_STATE = ALIVE_STATES;

export interface AliveSnapshot {
  /**
   * State per row, as a typed array.
   *
   * A Map of forty thousand entries rebuilt on every pointermove is the kind
   * of allocation that turns a smooth drag into a stutter. One byte per row,
   * reused, costs nothing.
   */
  readonly states: Uint8Array;
  readonly certain: number;
  readonly possible: number;
  readonly undated: number;
  readonly unborn: number;
  readonly deceased: number;
  readonly hidden: number;
}

const EMPTY: { earliest: null; latest: null } = { earliest: null, latest: null };

export function stateAt(row: TimelineRow, jdn: number, todayJdn: number): AliveState {
  if (row.redacted) return 'HIDDEN';

  const hasAnyDate =
    row.birthEarliestJdn !== null ||
    row.birthLatestJdn !== null ||
    row.deathEarliestJdn !== null ||
    row.deathLatestJdn !== null;
  if (!hasAnyDate) return 'UNDATED';

  const answer = wasAliveOnIntervals(
    {
      birth:
        row.birthEarliestJdn === null && row.birthLatestJdn === null
          ? EMPTY
          : { earliest: row.birthEarliestJdn, latest: row.birthLatestJdn },
      death:
        row.deathEarliestJdn === null && row.deathLatestJdn === null
          ? EMPTY
          : { earliest: row.deathEarliestJdn, latest: row.deathLatestJdn },
      isDeceased: row.isLiving ? false : undefined,
    },
    jdn,
    todayJdn,
  );

  if (answer === 'YES') return 'ALIVE_CERTAIN';
  if (answer === 'MAYBE') return 'ALIVE_POSSIBLE';

  // NO splits in two, and the difference matters on a timeline: someone not
  // yet born should fade in ahead of the cursor, while someone already dead
  // belongs to the past and should recede. Collapsing them into one "absent"
  // state would lose the direction of time.
  if (row.birthEarliestJdn !== null && jdn < row.birthEarliestJdn) return 'UNBORN';
  return 'DECEASED';
}

export function whoWasAlive(
  rows: readonly TimelineRow[],
  jdn: number,
  todayJdn: number,
  reuse?: Uint8Array,
): AliveSnapshot {
  const states = reuse && reuse.length === rows.length ? reuse : new Uint8Array(rows.length);

  let certain = 0;
  let possible = 0;
  let undated = 0;
  let unborn = 0;
  let deceased = 0;
  let hidden = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const state = stateAt(row, jdn, todayJdn);
    states[i] = STATE_CODE[state];

    switch (state) {
      case 'ALIVE_CERTAIN':
        certain += 1;
        break;
      case 'ALIVE_POSSIBLE':
        possible += 1;
        break;
      case 'UNDATED':
        undated += 1;
        break;
      case 'UNBORN':
        unborn += 1;
        break;
      case 'DECEASED':
        deceased += 1;
        break;
      case 'HIDDEN':
        hidden += 1;
        break;
    }
  }

  return { states, certain, possible, undated, unborn, deceased, hidden };
}

export function decodeState(code: number): AliveState {
  return CODE_STATE[code] ?? 'UNDATED';
}
