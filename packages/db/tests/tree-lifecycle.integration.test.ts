import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapDocument, parseGedcom, writeGedcom } from '@chronolignee/gedcom';
import {
  AccountErasureBlocked,
  TreeChangeRefused,
  buildGedcomPlan,
  createDatabase,
  createInvitation,
  createPerson,
  createTree,
  eraseAccount,
  findInvitation,
  importGedcomPlan,
  markTreeDeleted,
  planAccountErasure,
  purgeDeletedTree,
  treesAwaitingPurge,
  updateTreeSettings,
  type Database,
} from '../src/index';

/**
 * A tree's settings, its export, its end, and the end of an account.
 *
 * The GDPR-shaped workflows: what leaves with an export, what a deletion
 * really removes, and what erasing an account takes — and refuses to take.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const address = (who: string) => `lifecycle-${who}-${RUN}@chronolignee.invalid`;

let db: Database;
const users: Record<string, string> = {};
const trees: string[] = [];

async function user(who: string): Promise<string> {
  const created = await db.user.create({
    data: { email: address(who), name: who, emailVerified: false },
    select: { id: true },
  });
  users[who] = created.id;
  return created.id;
}

async function tree(name: string, owner: string): Promise<string> {
  const created = await createTree(db, { name: `${name} ${RUN}` }, owner);
  trees.push(created.treeId);
  return created.treeId;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TreeChangeRefused) return error.code;
    if (error instanceof AccountErasureBlocked) return 'BLOCKED';
    throw error;
  }
  return 'ACCEPTED';
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });
}, 60_000);

afterAll(async () => {
  for (const id of trees) await db.tree.delete({ where: { id } }).catch(() => undefined);
  for (const id of Object.values(users)) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
  await db.$disconnect();
});

const SAMPLE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME Étienne /CHASSAGNE/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 11 MAY 1762',
  '2 PLAC Tours',
  '1 DEAT',
  '2 DATE 30 JAN 1834',
  '0 @I2@ INDI',
  '1 NAME Jeanne /LEFÈVRE/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE ABT 1768',
  '0 @I3@ INDI',
  '1 NAME Pierre /CHASSAGNE/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE FRENCH_R 4 GERM 7',
  '0 @I4@ INDI',
  '1 NAME Sophie /CHASSAGNE/',
  '1 SEX F',
  '1 FAMC @F1@',
  '2 PEDI ADOPTED',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 CHIL @I4@',
  '1 MARR',
  '2 DATE 26 VENT 7',
  '0 @S1@ SOUR',
  '1 TITL Registres paroissiaux de Tours',
  '0 TRLR',
].join('\r\n');

describe('export', () => {
  it('writes back what an import brought in, uncertainty included', async () => {
    const owner = await user('export-owner');
    const treeId = await tree('Export', owner);
    await importGedcomPlan(db, mapDocument(parseGedcom(SAMPLE)), { treeId, actorId: owner });

    const exported = writeGedcom(await buildGedcomPlan(db, treeId));
    const reread = mapDocument(parseGedcom(exported));

    expect(reread.people).toHaveLength(4);
    expect(reread.relationships).toHaveLength(5);
    expect(reread.relationships.filter((link) => link.type === 'PARENT_ADOPTIVE')).toHaveLength(2);
    expect(reread.events.find((event) => event.date?.qualifier === 'ABOUT')).toBeDefined();
    const republican = reread.events.find((event) => event.date?.calendar === 'FRENCH_R');
    expect(republican?.date?.start).toEqual({ year: 7, month: 7, day: 4 });
    expect(reread.warnings).toEqual([]);
  });

  it('leaves archived people out of the file', async () => {
    const owner = await user('export-archive');
    const treeId = await tree('Archive', owner);
    const ctx = { treeId, actorId: owner };
    const kept = await createPerson(
      db,
      { names: [{ type: 'BIRTH', given: 'Kept', surname: 'X' }] },
      ctx,
    );
    const gone = await createPerson(
      db,
      { names: [{ type: 'BIRTH', given: 'Gone', surname: 'X' }] },
      ctx,
    );
    await db.person.update({ where: { id: gone.personId }, data: { deletedAt: new Date() } });

    const plan = await buildGedcomPlan(db, treeId);
    expect(plan.people.map((person) => person.names[0]?.given)).toEqual(['Kept']);
    expect(kept.personId).toBeTruthy();
  });
});

describe('settings', () => {
  it('records what changed, and refuses someone who does not run the tree', async () => {
    const owner = await user('settings-owner');
    const editor = await user('settings-editor');
    const treeId = await tree('Réglages', owner);
    await db.treeMember.create({ data: { treeId, userId: editor, role: 'EDITOR' } });

    const settings = {
      treeId,
      name: `Réglages ${RUN}`,
      description: '',
      visibility: 'LINK' as const,
      redactLivingPeople: true,
    };
    expect(await refusal(updateTreeSettings(db, settings, { userId: editor }))).toBe('NOT_ALLOWED');

    await updateTreeSettings(db, settings, { userId: owner });
    // Saving the same settings again is not a change.
    await updateTreeSettings(db, settings, { userId: owner });
    const revisions = await db.revision.findMany({
      where: { treeId, entityType: 'Tree', action: 'UPDATE' },
      select: { before: true, after: true },
    });
    expect(revisions).toEqual([
      { before: { visibility: 'PRIVATE' }, after: { visibility: 'LINK' } },
    ]);
  });
});

describe('deleting a tree', () => {
  it('asks for the name, then takes the tree out of use at once', async () => {
    const owner = await user('delete-owner');
    const admin = await user('delete-admin');
    const treeId = await tree('Suppression', owner);
    await db.treeMember.create({ data: { treeId, userId: admin, role: 'ADMIN' } });
    const invitation = await createInvitation(
      db,
      { treeId, email: address('delete-guest'), role: 'VIEWER' },
      { userId: owner },
    );

    // Only the owner, and only with the tree's name typed out.
    expect(
      await refusal(
        markTreeDeleted(db, { treeId, confirmation: `Suppression ${RUN}` }, { userId: admin }),
      ),
    ).toBe('NOT_ALLOWED');
    expect(
      await refusal(
        markTreeDeleted(db, { treeId, confirmation: 'Suppression' }, { userId: owner }),
      ),
    ).toBe('CONFIRMATION_MISMATCH');

    await markTreeDeleted(db, { treeId, confirmation: ` Suppression ${RUN} ` }, { userId: owner });
    expect(await findInvitation(db, invitation.token)).toBeNull();
    expect(await treesAwaitingPurge(db)).toContain(treeId);
  });

  it('purges every row of a deleted tree, and never a live one', async () => {
    const owner = await user('purge-owner');
    const live = await tree('Vivant', owner);
    expect(await purgeDeletedTree(db, live)).toBe(false);
    expect(await db.tree.count({ where: { id: live } })).toBe(1);

    const treeId = await tree('Purge', owner);
    await importGedcomPlan(db, mapDocument(parseGedcom(SAMPLE)), { treeId, actorId: owner });
    await markTreeDeleted(db, { treeId, confirmation: `Purge ${RUN}` }, { userId: owner });

    expect(await purgeDeletedTree(db, treeId)).toBe(true);
    const left = await Promise.all([
      db.person.count({ where: { treeId } }),
      db.event.count({ where: { treeId } }),
      db.relationship.count({ where: { treeId } }),
      db.source.count({ where: { treeId } }),
      db.revision.count({ where: { treeId } }),
      db.treeMember.count({ where: { treeId } }),
    ]);
    expect(left).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('erasing an account', () => {
  it('refuses while it alone owns a tree others still work in', async () => {
    const alice = await user('alice');
    const bruno = await user('bruno');
    const alone = await tree('Seule', alice);
    const shared = await tree('Partagé', alice);
    const joined = await db.treeMember.create({
      data: { treeId: shared, userId: bruno, role: 'EDITOR' },
      select: { id: true },
    });

    const plan = await planAccountErasure(db, alice);
    expect(plan.blocking.map((ref) => ref.treeId)).toEqual([shared]);
    expect(plan.erasedWithAccount.map((ref) => ref.treeId)).toEqual([alone]);
    expect(await refusal(eraseAccount(db, alice))).toBe('BLOCKED');
    // Refused means untouched.
    expect(await db.user.count({ where: { id: alice } })).toBe(1);
    expect(await db.tree.count({ where: { id: alone, deletedAt: null } })).toBe(1);
    expect(joined.id).toBeTruthy();
  });

  it('takes the account, its lone trees and its address; keeps the shared research', async () => {
    const alice = users['alice'] as string;
    const bruno = users['bruno'] as string;
    const [alone, shared] = trees.slice(-2) as [string, string];
    await db.treeMember.update({
      where: { treeId_userId: { treeId: shared, userId: bruno } },
      data: { role: 'OWNER' },
    });
    const person = await createPerson(
      db,
      { names: [{ type: 'BIRTH', given: 'Recherche', surname: 'Commune' }] },
      { treeId: shared, actorId: alice },
    );
    const elsewhere = await tree('Ailleurs', bruno);
    await createInvitation(
      db,
      { treeId: elsewhere, email: address('alice'), role: 'VIEWER' },
      { userId: bruno },
    );

    const { treesToPurge } = await eraseAccount(db, alice);

    expect(treesToPurge).toEqual([alone]);
    expect(await db.tree.count({ where: { id: alone, deletedAt: { not: null } } })).toBe(1);
    expect(await db.user.count({ where: { id: alice } })).toBe(0);
    expect(await db.treeInvitation.count({ where: { email: address('alice') } })).toBe(0);
    // The research stays, no longer signed.
    const kept = await db.person.findUniqueOrThrow({
      where: { id: person.personId },
      select: { deletedAt: true },
    });
    expect(kept.deletedAt).toBeNull();
    const authored = await db.revision.findFirstOrThrow({
      where: { treeId: shared, entityId: person.personId },
      select: { actorId: true },
    });
    expect(authored.actorId).toBeNull();
    // The shared tree says someone left, without naming them.
    const departure = await db.revision.findFirstOrThrow({
      where: { treeId: shared, entityType: 'TreeMember', summary: 'Compte supprimé' },
      select: { summary: true },
    });
    expect(JSON.stringify(departure)).not.toContain('alice');
    delete users['alice'];
  });
});
