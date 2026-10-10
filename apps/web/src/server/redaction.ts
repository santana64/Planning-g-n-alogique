import { PROTECTED_LABEL } from '@chronolignee/domain';
import type { EdgeCertainty } from '@chronolignee/ui';

/**
 * What a hidden person's record becomes before it leaves the server.
 *
 * Pure, so the whole list of blanked fields can be tested: a field forgotten
 * here is not hidden by any component — it is serialised into the page, where
 * anyone can read it without the interface ever showing it.
 */

export const REDACTED_LABEL = PROTECTED_LABEL;

/**
 * The person keeps their row. Removing them would change the shape of the
 * family and make the tree a quiet lie about who exists; what disappears is
 * everything that identifies them — name, dates, places.
 *
 * With no dates there is no position, so no bar can be drawn. Rather than
 * leaving a silent empty row, the record is flagged `redacted` and the
 * timeline draws an explicit marker: "someone is here, and their details are
 * protected" is information, while a blank row is a bug.
 */
export interface RedactablePerson {
  readonly displayName: string;
  readonly isLiving: boolean;
  readonly birthLabel: string;
  readonly deathLabel: string;
  readonly lifespanLabel: string;
  readonly earliestJdn: number | null;
  readonly latestJdn: number | null;
  readonly birthEarliestJdn: number | null;
  readonly birthLatestJdn: number | null;
  readonly deathEarliestJdn: number | null;
  readonly deathLatestJdn: number | null;
  readonly startCertainty: EdgeCertainty;
  readonly endCertainty: EdgeCertainty;
  readonly redacted: boolean;
  /** Present on timeline rows; blanked like every other identifying field. */
  readonly sex?: 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN';
}

export function redactPerson<T extends RedactablePerson>(person: T, hidden: boolean): T {
  if (!hidden) return person;

  return {
    ...person,
    displayName: REDACTED_LABEL,
    birthLabel: '—',
    deathLabel: '—',
    // "1962 –" is the birth year the name was hidden to protect.
    lifespanLabel: '',
    // Why someone is protected is itself protected: "living" beside a hidden
    // name tells a stranger that this relative is alive today.
    isLiving: false,
    earliestJdn: null,
    latestJdn: null,
    // The separate windows go too. Keeping them would let the time cursor
    // reconstruct the birth year the name was hidden to protect.
    birthEarliestJdn: null,
    birthLatestJdn: null,
    deathEarliestJdn: null,
    deathLatestJdn: null,
    // "Exact" says the birth was recorded to the day.
    startCertainty: 'UNKNOWN',
    endCertainty: 'UNKNOWN',
    // "Daughter of" narrows a hidden relative down to half the candidates.
    ...(person.sex === undefined ? {} : { sex: 'UNKNOWN' as const }),
    redacted: true,
  };
}
