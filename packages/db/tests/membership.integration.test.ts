import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TreeRole } from '@chronolignee/domain';
import {
  MembershipRefused,
  acceptInvitation,
  changeMemberRole,
  createDatabase,
  createInvitation,
  createTree,
  findInvitation,
  hashInvitationToken,
  listMembers,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
  type Database,
} from '../src/index';

/**
 * Who belongs to a tree.
 *
 * The permission table decides who may change whose role; these tests are
 * about what only the database knows — the last owner, the single use of a
 * link, the address it was sent to — and about what must never be stored.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const address = (who: string) => `membership-${who}-${RUN}@chronolignee.invalid`;

let db: Database;
let treeId: string;
const users: Record<string, string> = {};

async function user(who: string): Promise<string> {
  const created = await db.user.create({
    data: { email: address(who), name: who, emailVerified: false },
    select: { id: true },
  });
  users[who] = created.id;
  return created.id;
}

async function join(who: string, role: TreeRole): Promise<string> {
  const member = await db.treeMember.create({
    data: { treeId, userId: users[who] ?? (await user(who)), role },
    select: { id: true },
  });
  return member.id;
}

async function memberIdOf(who: string): Promise<string> {
  const member = await db.treeMember.findUniqueOrThrow({
    where: { treeId_userId: { treeId, userId: users[who] as string } },
    select: { id: true },
  });
  return member.id;
}

/** The acting account. Its role is whatever the tree says, read by the service. */
const as = (who: string) => ({ userId: users[who] as string });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MembershipRefused) return error.code;
    throw error;
  }
  return 'ACCEPTED';
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const owner = await user('noah');
  const tree = await createTree(db, { name: `Adhésion ${RUN}` }, owner);
  treeId = tree.treeId;
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  for (const id of Object.values(users)) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
  await db.$disconnect();
});

describe('invitations', () => {
  it('stores a hash of the link, never the link', async () => {
    const created = await createInvitation(
      db,
      { treeId, email: address('lea'), role: 'EDITOR' },
      as('noah'),
    );
    const row = await db.treeInvitation.findUniqueOrThrow({
      where: { id: created.invitationId },
      select: { tokenHash: true },
    });
    expect(created.token.length).toBeGreaterThanOrEqual(43);
    expect(row.tokenHash).not.toContain(created.token);
    expect(row.tokenHash).toBe(hashInvitationToken(created.token));
  });

  it('lets the invited account in once, with the role it was offered', async () => {
    const lea = users['lea'] ?? (await user('lea'));
    const created = await createInvitation(
      db,
      { treeId, email: address('lea'), role: 'CONTRIBUTOR' },
      as('noah'),
    );

    const joined = await acceptInvitation(db, { token: created.token, userId: lea });
    expect(joined.role).toBe('CONTRIBUTOR');
    const members = await listMembers(db, treeId);
    expect(members.find((member) => member.userId === lea)?.role).toBe('CONTRIBUTOR');

    expect(await refusal(acceptInvitation(db, { token: created.token, userId: lea }))).toBe('USED');
  });

  it('keeps out an account the link was not sent to', async () => {
    const stranger = await user('mallory');
    const created = await createInvitation(
      db,
      { treeId, email: address('camille'), role: 'VIEWER' },
      as('noah'),
    );

    expect(await refusal(acceptInvitation(db, { token: created.token, userId: stranger }))).toBe(
      'WRONG_ACCOUNT',
    );
    // Still good for the person it was meant for.
    expect((await findInvitation(db, created.token))?.status).toBe('PENDING');
  });

  it('matches the address whatever its case', async () => {
    const mateo = await user('mateo');
    const created = await createInvitation(
      db,
      { treeId, email: address('mateo').toUpperCase(), role: 'VIEWER' },
      as('noah'),
    );
    expect((await acceptInvitation(db, { token: created.token, userId: mateo })).role).toBe(
      'VIEWER',
    );
  });

  it('refuses an expired link, and a revoked one', async () => {
    const sylvie = await user('sylvie');
    const lastWeek = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const stale = await createInvitation(
      db,
      { treeId, email: address('sylvie'), role: 'VIEWER' },
      as('noah'),
      lastWeek,
    );
    expect(await refusal(acceptInvitation(db, { token: stale.token, userId: sylvie }))).toBe(
      'EXPIRED',
    );

    const fresh = await createInvitation(
      db,
      { treeId, email: address('sylvie'), role: 'VIEWER' },
      as('noah'),
    );
    await revokeInvitation(db, { treeId, invitationId: fresh.invitationId }, as('noah'));
    expect(await refusal(acceptInvitation(db, { token: fresh.token, userId: sylvie }))).toBe(
      'REVOKED',
    );
  });

  it('replaces an earlier invitation to the same address', async () => {
    const first = await createInvitation(
      db,
      { treeId, email: address('thomas'), role: 'VIEWER' },
      as('noah'),
    );
    const second = await createInvitation(
      db,
      { treeId, email: address('thomas'), role: 'EDITOR' },
      as('noah'),
    );
    expect((await findInvitation(db, first.token))?.status).toBe('REVOKED');
    const pending = await listPendingInvitations(db, treeId);
    expect(pending.filter((row) => row.email === address('thomas'))).toEqual([
      expect.objectContaining({ invitationId: second.invitationId, role: 'EDITOR' }),
    ]);
  });

  it('never offers ownership, and lets an administrator offer only what is below them', async () => {
    const admin = await join('claire', 'ADMIN');
    expect(admin).toBeTruthy();
    const offer = (role: TreeRole, actorRole: TreeRole) =>
      refusal(
        createInvitation(
          db,
          { treeId, email: address(`offer-${role}`), role },
          as(actorRole === 'OWNER' ? 'noah' : 'claire'),
        ),
      );
    expect(await offer('OWNER', 'OWNER')).toBe('NOT_ALLOWED');
    expect(await offer('ADMIN', 'ADMIN')).toBe('NOT_ALLOWED');
    expect(await offer('EDITOR', 'ADMIN')).toBe('ACCEPTED');
  });

  it('keeps the invited address out of the history', async () => {
    const revisions = await db.revision.findMany({
      where: { treeId, entityType: 'TreeInvitation' },
      select: { summary: true, before: true, after: true },
    });
    expect(revisions.length).toBeGreaterThan(0);
    expect(JSON.stringify(revisions)).not.toContain('@chronolignee.invalid');
  });

  it('refuses an address that is already a member', async () => {
    expect(
      await refusal(
        createInvitation(db, { treeId, email: address('claire'), role: 'VIEWER' }, as('noah')),
      ),
    ).toBe('ALREADY_MEMBER');
  });
});

describe('roles and removal', () => {
  it('lets an administrator manage an editor but not another administrator', async () => {
    const editor = await join('valentina', 'EDITOR');
    const peer = await join('octave', 'ADMIN');

    await changeMemberRole(db, { treeId, memberId: editor, role: 'VIEWER' }, as('claire'));
    expect(
      await refusal(changeMemberRole(db, { treeId, memberId: peer, role: 'VIEWER' }, as('claire'))),
    ).toBe('NOT_ALLOWED');
    expect(await refusal(removeMember(db, { treeId, memberId: peer }, as('claire')))).toBe(
      'NOT_ALLOWED',
    );
    expect((await removeMember(db, { treeId, memberId: editor }, as('claire'))).left).toBe(false);
  });

  it('never leaves the tree without an owner', async () => {
    const noah = await memberIdOf('noah');
    expect(await refusal(removeMember(db, { treeId, memberId: noah }, as('noah')))).toBe(
      'LAST_OWNER',
    );
    expect(
      await refusal(changeMemberRole(db, { treeId, memberId: noah, role: 'ADMIN' }, as('noah'))),
    ).toBe('LAST_OWNER');

    // With a second owner, the first may step down.
    const claire = await memberIdOf('claire');
    await changeMemberRole(db, { treeId, memberId: claire, role: 'OWNER' }, as('noah'));
    await changeMemberRole(db, { treeId, memberId: noah, role: 'ADMIN' }, as('noah'));
    const roles = Object.fromEntries(
      (await listMembers(db, treeId)).map((member) => [member.name, member.role]),
    );
    expect(roles['noah']).toBe('ADMIN');
    expect(roles['claire']).toBe('OWNER');
  });

  it('holds when two owners step down at once', async () => {
    // Claire and Noah owners again, then both demote themselves together.
    const noah = await memberIdOf('noah');
    const claire = await memberIdOf('claire');
    await changeMemberRole(db, { treeId, memberId: noah, role: 'OWNER' }, as('claire'));

    const outcomes = await Promise.all([
      refusal(changeMemberRole(db, { treeId, memberId: noah, role: 'ADMIN' }, as('noah'))),
      refusal(changeMemberRole(db, { treeId, memberId: claire, role: 'ADMIN' }, as('claire'))),
    ]);
    expect(outcomes.sort()).toEqual(['ACCEPTED', 'LAST_OWNER']);
    const owners = await db.treeMember.count({ where: { treeId, role: 'OWNER' } });
    expect(owners).toBe(1);
  });

  it('lets anyone leave, and records it', async () => {
    const lea = await memberIdOf('lea');
    expect((await removeMember(db, { treeId, memberId: lea }, as('lea'))).left).toBe(true);
    const revision = await db.revision.findFirstOrThrow({
      where: { treeId, entityType: 'TreeMember', entityId: lea, action: 'DELETE' },
      select: { summary: true, before: true },
    });
    expect(revision.summary).toBe('A quitté l’arbre');
    // By account, not by name: a name in the history would outlive the account.
    expect(revision.before).toEqual({ role: 'CONTRIBUTOR', userId: users['lea'] });
    const everything = await db.revision.findMany({
      where: { treeId, entityType: 'TreeMember' },
      select: { summary: true },
    });
    for (const name of ['lea', 'claire', 'noah', 'valentina']) {
      expect(everything.some((row) => row.summary?.includes(name))).toBe(false);
    }
  });

  it('refuses a member who may not manage members', async () => {
    const viewer = await join('odette', 'VIEWER');
    const target = await join('hippolyte', 'VIEWER');
    expect(
      await refusal(
        changeMemberRole(db, { treeId, memberId: target, role: 'EDITOR' }, as('odette')),
      ),
    ).toBe('NOT_ALLOWED');
    expect(await refusal(removeMember(db, { treeId, memberId: target }, as('odette')))).toBe(
      'NOT_ALLOWED',
    );
    expect(viewer).toBeTruthy();
  });
});
