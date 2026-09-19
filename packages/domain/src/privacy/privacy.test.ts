import { describe, expect, it } from 'vitest';
import { gregorianToJdn } from '../date/calendar';
import {
  isHiddenFrom,
  isPresumedLiving,
  privacySubjectFromColumns,
  type PrivacySubject,
  type PrivacyViewer,
} from './index';

/**
 * Who may see a person.
 *
 * Every case here is a person someone could be exposed as, or wrongly hidden
 * from their own family.
 */

const TODAY = gregorianToJdn(2026, 9, 19);

const STRANGER: PrivacyViewer = { role: null, redactLiving: true };
const STRANGER_OF_AN_OPEN_TREE: PrivacyViewer = { role: null, redactLiving: false };
const VIEWER: PrivacyViewer = { role: 'VIEWER', redactLiving: false };
const EDITOR: PrivacyViewer = { role: 'EDITOR', redactLiving: false };
const ADMIN: PrivacyViewer = { role: 'ADMIN', redactLiving: false };
const OWNER: PrivacyViewer = { role: 'OWNER', redactLiving: false };

function subject(fields: Partial<PrivacySubject>): PrivacySubject {
  return {
    livingStatus: 'UNKNOWN',
    privacy: 'INHERIT',
    birthEarliestJdn: null,
    deathRecorded: false,
    ...fields,
  };
}

describe('presumed living', () => {
  it('takes a recorded status at its word', () => {
    expect(isPresumedLiving(subject({ livingStatus: 'LIVING' }), TODAY)).toBe(true);
    expect(isPresumedLiving(subject({ livingStatus: 'DECEASED' }), TODAY)).toBe(false);
  });

  it('presumes an imported person with no status and a recent birth to be living', () => {
    // The case that used to leak: a GEDCOM import records no status at all.
    const cousin = subject({ birthEarliestJdn: gregorianToJdn(1987, 4, 2) });
    expect(isPresumedLiving(cousin, TODAY)).toBe(true);
    expect(isHiddenFrom(cousin, STRANGER, TODAY)).toBe(true);
  });

  it('lets a recorded death end the presumption', () => {
    const died = subject({ birthEarliestJdn: gregorianToJdn(1987, 4, 2), deathRecorded: true });
    expect(isPresumedLiving(died, TODAY)).toBe(false);
  });

  it('does not presume alive someone born beyond any recorded lifespan', () => {
    const ancestor = subject({ birthEarliestJdn: gregorianToJdn(1822, 6, 12) });
    expect(isPresumedLiving(ancestor, TODAY)).toBe(false);
    expect(isHiddenFrom(ancestor, STRANGER, TODAY)).toBe(false);
  });

  it('counts from the earliest possible birth, against the longest recorded life', () => {
    // Born no later than 1900: past 123 years. From 1905: possibly still alive.
    expect(isPresumedLiving(subject({ birthEarliestJdn: gregorianToJdn(1900, 1, 1) }), TODAY)).toBe(
      false,
    );
    expect(isPresumedLiving(subject({ birthEarliestJdn: gregorianToJdn(1905, 1, 1) }), TODAY)).toBe(
      true,
    );
  });

  it('presumes living a person with no dates at all, by prudence', () => {
    expect(isPresumedLiving(subject({}), TODAY)).toBe(true);
  });
});

describe('the tree’s rule, for people who follow it', () => {
  const living = subject({ livingStatus: 'LIVING' });

  it('hides the living from strangers when the tree asks, which is the default', () => {
    expect(isHiddenFrom(living, STRANGER, TODAY)).toBe(true);
  });

  it('shows them when the tree has chosen to publish its living', () => {
    expect(isHiddenFrom(living, STRANGER_OF_AN_OPEN_TREE, TODAY)).toBe(false);
  });

  it('never hides them from the tree’s own members', () => {
    for (const member of [VIEWER, EDITOR, ADMIN, OWNER]) {
      expect(isHiddenFrom(living, member, TODAY)).toBe(false);
    }
  });

  it('does not let a stray redactLiving flag hide a member’s own family', () => {
    expect(isHiddenFrom(living, { role: 'VIEWER', redactLiving: true }, TODAY)).toBe(false);
  });
});

describe('a person’s own setting', () => {
  it('keeps a restricted person to the tree’s administrators', () => {
    const restricted = subject({ livingStatus: 'DECEASED', privacy: 'RESTRICTED' });
    expect(isHiddenFrom(restricted, STRANGER_OF_AN_OPEN_TREE, TODAY)).toBe(true);
    expect(isHiddenFrom(restricted, VIEWER, TODAY)).toBe(true);
    expect(isHiddenFrom(restricted, EDITOR, TODAY)).toBe(true);
    expect(isHiddenFrom(restricted, ADMIN, TODAY)).toBe(false);
    expect(isHiddenFrom(restricted, OWNER, TODAY)).toBe(false);
  });

  it('hides a redacted person from strangers even after death', () => {
    const redacted = subject({ livingStatus: 'DECEASED', privacy: 'REDACTED' });
    expect(isHiddenFrom(redacted, STRANGER_OF_AN_OPEN_TREE, TODAY)).toBe(true);
    expect(isHiddenFrom(redacted, VIEWER, TODAY)).toBe(false);
  });

  it('publishes a person marked visible, deliberately, even living', () => {
    const consented = subject({ livingStatus: 'LIVING', privacy: 'VISIBLE' });
    expect(isHiddenFrom(consented, STRANGER, TODAY)).toBe(false);
  });
});

describe('from the cached columns', () => {
  it('reads a recorded death as an end of life that was not inferred', () => {
    expect(
      privacySubjectFromColumns({
        livingStatus: 'UNKNOWN',
        privacy: 'INHERIT',
        lifespanEarliestJdn: gregorianToJdn(1987, 1, 1),
        lifespanLatestJdn: gregorianToJdn(2020, 1, 1),
        lifespanLatestInferred: false,
      }).deathRecorded,
    ).toBe(true);
    expect(
      privacySubjectFromColumns({
        livingStatus: 'UNKNOWN',
        privacy: 'INHERIT',
        lifespanEarliestJdn: gregorianToJdn(1987, 1, 1),
        lifespanLatestJdn: gregorianToJdn(2110, 1, 1),
        lifespanLatestInferred: true,
      }).deathRecorded,
    ).toBe(false);
  });
});
