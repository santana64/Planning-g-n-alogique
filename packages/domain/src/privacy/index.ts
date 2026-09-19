/**
 * Who may see a person. The single rule.
 *
 * Every projection — list, record, timeline, map, fan, constellation, story,
 * search — asks this and nothing else. Each blanks its own fields, because a
 * list row and a timeline bar carry different ones, but none of them decides
 * *whether* to blank: several redaction leaks came from code that re-derived
 * that decision locally and got it subtly wrong.
 *
 * Two layers:
 *
 * - the person's own setting, chosen by the tree's editors: RESTRICTED (only
 *   the tree's administrators), REDACTED (hidden outside the tree even after
 *   death), VISIBLE (published deliberately), or INHERIT (the tree's rule);
 * - the tree's rule for INHERIT: outside the tree, a presumed-living person is
 *   hidden when the tree asks for it, which it does by default.
 *
 * "Presumed living" is deliberately wider than "recorded as living". A person
 * imported from another program usually arrives with no status at all, and
 * treating "unknown" as "dead" published every living relative in such a tree.
 * Without a status, a person is presumed living until the record ends their
 * life — a death — or their birth is further back than any recorded human
 * lifespan; with no dates at all, they are presumed living too. Wrongly hiding
 * an undated ancestor from strangers costs a little; wrongly publishing a
 * living cousin cannot be undone.
 */

import { MAX_PLAUSIBLE_LIFESPAN_YEARS } from '../date/types';
import type { TreeRole } from '../permissions/index';

export type PersonPrivacy = 'INHERIT' | 'VISIBLE' | 'REDACTED' | 'RESTRICTED';
export const PERSON_PRIVACY_LEVELS: readonly PersonPrivacy[] = [
  'INHERIT',
  'REDACTED',
  'RESTRICTED',
  'VISIBLE',
];
export type LivingStatus = 'LIVING' | 'DECEASED' | 'UNKNOWN';
export type ViewerRole = TreeRole;

/**
 * The setting a person starts with, and returns to when their status changes
 * and nobody chose otherwise.
 *
 * Someone recorded as living is hidden outside the tree whatever the tree's
 * rule says: a tree made public later must not publish them in passing.
 */
export function defaultPersonPrivacy(livingStatus: LivingStatus): PersonPrivacy {
  return livingStatus === 'LIVING' ? 'REDACTED' : 'INHERIT';
}

export interface PrivacySubject {
  readonly livingStatus: LivingStatus;
  readonly privacy: PersonPrivacy;
  /** The earliest possible birth, from the record; null when undated. */
  readonly birthEarliestJdn: number | null;
  /** A death, burial or accepted death claim is recorded. */
  readonly deathRecorded: boolean;
}

export interface PrivacyViewer {
  /** Null for someone outside the tree. */
  readonly role: ViewerRole | null;
  /** The tree's own rule: hide presumed-living people from outsiders. */
  readonly redactLiving: boolean;
}

const DAYS_PER_YEAR = 365.2425;

export function isPresumedLiving(person: PrivacySubject, todayJdn: number): boolean {
  if (person.livingStatus === 'LIVING') return true;
  if (person.livingStatus === 'DECEASED' || person.deathRecorded) return false;
  if (person.birthEarliestJdn === null) return true;
  // Even the earliest possible birth leaves room for a life that has not ended.
  return todayJdn - person.birthEarliestJdn < MAX_PLAUSIBLE_LIFESPAN_YEARS * DAYS_PER_YEAR;
}

export function isHiddenFrom(
  person: PrivacySubject,
  viewer: PrivacyViewer,
  todayJdn: number,
): boolean {
  switch (person.privacy) {
    case 'RESTRICTED':
      return viewer.role !== 'OWNER' && viewer.role !== 'ADMIN';
    case 'REDACTED':
      return viewer.role === null;
    case 'VISIBLE':
      return false;
    case 'INHERIT':
      return viewer.role === null && viewer.redactLiving && isPresumedLiving(person, todayJdn);
  }
}

/**
 * The subject, from the cached lifespan columns every person row carries.
 *
 * A recorded death shows there as an end of life that was not inferred: the
 * projection only infers an end when none is recorded.
 */
export function privacySubjectFromColumns(row: {
  readonly livingStatus: LivingStatus;
  readonly privacy: PersonPrivacy;
  readonly lifespanEarliestJdn: number | null;
  readonly lifespanLatestJdn: number | null;
  readonly lifespanLatestInferred: boolean;
}): PrivacySubject {
  return {
    livingStatus: row.livingStatus,
    privacy: row.privacy,
    birthEarliestJdn: row.lifespanEarliestJdn,
    deathRecorded: row.lifespanLatestJdn !== null && !row.lifespanLatestInferred,
  };
}

/** Shown in place of the name of anyone this rule hides. Says nothing about why. */
export const PROTECTED_LABEL = 'Personne protégée';
