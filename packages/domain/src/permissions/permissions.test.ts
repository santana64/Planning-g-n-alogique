import { describe, expect, it } from 'vitest';
import {
  INVITABLE_ROLES,
  TREE_ROLES,
  can,
  canChangeMembership,
  canInvite,
  canSetPersonPrivacy,
  type TreeCapability,
  type TreeRole,
} from './index';

const ALL: readonly TreeCapability[] = [
  'contribute',
  'delete',
  'import',
  'export',
  'setPersonPrivacy',
  'manageMembers',
  'manageTree',
  'deleteTree',
];

const allowed = (role: TreeRole | null) => ALL.filter((capability) => can(role, capability));

describe('can', () => {
  it('gives the owner everything', () => {
    expect(allowed('OWNER')).toEqual(ALL);
  });

  it('gives an administrator everything but erasing the tree', () => {
    expect(allowed('ADMIN')).toEqual(ALL.filter((capability) => capability !== 'deleteTree'));
  });

  it('lets an editor research, not run the tree', () => {
    expect(allowed('EDITOR')).toEqual(['contribute', 'delete', 'import']);
  });

  it('lets a contributor add and correct, never remove', () => {
    expect(allowed('CONTRIBUTOR')).toEqual(['contribute']);
    expect(can('CONTRIBUTOR', 'delete')).toBe(false);
  });

  it('lets a viewer change nothing', () => {
    expect(allowed('VIEWER')).toEqual([]);
  });

  it('lets someone outside the tree change nothing', () => {
    expect(allowed(null)).toEqual([]);
  });
});

describe('canChangeMembership', () => {
  it('lets an owner give any role, ownership included', () => {
    for (const from of TREE_ROLES) {
      for (const to of TREE_ROLES) {
        expect(canChangeMembership('OWNER', from, to)).toBe(true);
      }
    }
  });

  it('lets an administrator manage the roles below their own', () => {
    expect(canChangeMembership('ADMIN', 'VIEWER', 'EDITOR')).toBe(true);
    expect(canChangeMembership('ADMIN', 'EDITOR', null)).toBe(true);
    expect(canChangeMembership('ADMIN', null, 'CONTRIBUTOR')).toBe(true);
  });

  it('does not let an administrator create a peer or touch one', () => {
    expect(canChangeMembership('ADMIN', 'EDITOR', 'ADMIN')).toBe(false);
    expect(canChangeMembership('ADMIN', 'ADMIN', 'VIEWER')).toBe(false);
    expect(canChangeMembership('ADMIN', 'ADMIN', null)).toBe(false);
    expect(canChangeMembership('ADMIN', 'OWNER', 'VIEWER')).toBe(false);
  });

  it('refuses anyone without the right to manage members', () => {
    for (const actor of ['EDITOR', 'CONTRIBUTOR', 'VIEWER', null] as const) {
      expect(canChangeMembership(actor, 'VIEWER', 'CONTRIBUTOR')).toBe(false);
      expect(canChangeMembership(actor, null, 'VIEWER')).toBe(false);
    }
  });

  it('refuses a change from nothing to nothing', () => {
    expect(canChangeMembership('OWNER', null, null)).toBe(false);
  });
});

describe('canInvite', () => {
  it('never carries ownership in a link', () => {
    expect(INVITABLE_ROLES).not.toContain('OWNER');
    expect(canInvite('OWNER', 'OWNER')).toBe(false);
  });

  it('lets an owner invite an administrator, and an administrator only below', () => {
    expect(canInvite('OWNER', 'ADMIN')).toBe(true);
    expect(canInvite('ADMIN', 'ADMIN')).toBe(false);
    expect(canInvite('ADMIN', 'EDITOR')).toBe(true);
    expect(canInvite('EDITOR', 'VIEWER')).toBe(false);
  });
});

describe('canSetPersonPrivacy', () => {
  it('lets a contributor follow or tighten the tree’s rule', () => {
    expect(canSetPersonPrivacy('CONTRIBUTOR', 'INHERIT', 'REDACTED')).toBe(true);
    expect(canSetPersonPrivacy('CONTRIBUTOR', 'REDACTED', 'INHERIT')).toBe(true);
  });

  it('keeps publishing and restricting to the people who run the tree', () => {
    expect(canSetPersonPrivacy('EDITOR', 'REDACTED', 'VISIBLE')).toBe(false);
    expect(canSetPersonPrivacy('EDITOR', 'INHERIT', 'RESTRICTED')).toBe(false);
    expect(canSetPersonPrivacy('EDITOR', 'VISIBLE', 'INHERIT')).toBe(false);
    expect(canSetPersonPrivacy('ADMIN', 'REDACTED', 'VISIBLE')).toBe(true);
    expect(canSetPersonPrivacy('OWNER', 'RESTRICTED', 'INHERIT')).toBe(true);
  });

  it('lets anyone who may edit resubmit a setting unchanged', () => {
    // The form always sends the setting; an editor saving a corrected date
    // on a published person must not be refused for a choice they did not make.
    expect(canSetPersonPrivacy('EDITOR', 'VISIBLE', 'VISIBLE')).toBe(true);
  });

  it('lets a viewer set nothing', () => {
    expect(canSetPersonPrivacy('VIEWER', 'INHERIT', 'INHERIT')).toBe(false);
    expect(canSetPersonPrivacy(null, 'INHERIT', 'REDACTED')).toBe(false);
  });
});
