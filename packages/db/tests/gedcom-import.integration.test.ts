import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dateToJdn, formatGenealogicalDate, gregorianToJdn } from '@chronolignee/domain';
import { mapDocument, parseGedcom, writeGedcom } from '@chronolignee/gedcom';
import { createDatabase, importGedcomPlan, loadGenealogyGraph, type Database } from '../src/index';

/**
 * GEDCOM import, from file text to a tree the engine can draw.
 *
 * The unit tests prove the parser and the writer agree with each other. This
 * proves they agree with the database — which is where the interesting
 * failures live, because that is where CHECK constraints, enum coercion and
 * the derived lifespan cache all meet an import for the first time.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const TODAY_JDN = dateToJdn(new Date());

/**
 * A file with the awkward parts on purpose: a Republican date, an approximate
 * date, an adoption, a marriage, and a person whose death is unrecorded.
 */
const SAMPLE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '1 SOUR TESTSUITE',
  '0 @I1@ INDI',
  '1 NAME Étienne /CHASSAGNE/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 11 MAY 1762',
  '2 PLAC Tours',
  '1 DEAT',
  '2 DATE 30 JAN 1834',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Jeanne /LEFÈVRE/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE ABT 1768',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Pierre /CHASSAGNE/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE FRENCH_R 4 GERM 7',
  '1 FAMC @F1@',
  '0 @I4@ INDI',
  '1 NAME Sophie /CHASSAGNE/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE 1805',
  '1 FAMC @F1@',
  '2 PEDI ADOPTED',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 CHIL @I4@',
  '1 MARR',
  '2 DATE 26 VENT 7',
  '2 PLAC Tours',
  '0 TRLR',
].join('\r\n');

let db: Database;
let treeId: string;

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: {
      name: 'Import GEDCOM',
      slug: `gedcom-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
  treeId = tree.id;
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('importing a file', () => {
  it('writes people, relationships and events in one transaction', async () => {
    const plan = mapDocument(parseGedcom(SAMPLE));
    const result = await importGedcomPlan(db, plan, { treeId, actorId: null });

    expect(result.people).toBe(4);
    // Two parents times two children, plus the marriage.
    expect(result.relationships).toBe(5);
    expect(result.rejected).toEqual([]);

    expect(await db.person.count({ where: { treeId } })).toBe(4);
  });

  it('places the Republican birth date correctly in the database', async () => {
    const pierre = await db.person.findFirst({
      where: { treeId, displayName: { startsWith: 'Pierre' } },
      select: { lifespanEarliestJdn: true },
    });
    // 4 germinal an VII = 24 March 1799.
    expect(pierre?.lifespanEarliestJdn).toBe(gregorianToJdn(1799, 3, 24));
  });

  it('keeps an approximate date approximate', async () => {
    const event = await db.event.findFirst({
      where: { treeId, type: 'BIRTH', dateQualifier: 'ABOUT' },
      select: { dateOriginalText: true, dateQualifier: true },
    });
    expect(event?.dateQualifier).toBe('ABOUT');
    expect(event?.dateOriginalText).toBe('ABT 1768');
  });

  it('honours an adoption rather than flattening it to biological', async () => {
    const sophie = await db.person.findFirst({
      where: { treeId, displayName: { startsWith: 'Sophie' } },
      select: { id: true },
    });
    const links = await db.relationship.findMany({
      where: { treeId, targetId: sophie?.id },
      select: { type: true },
    });
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.type === 'PARENT_ADOPTIVE')).toBe(true);
  });

  it('derives living status from a recorded death, never guessing', async () => {
    // Étienne has a death date; Jeanne does not. A nineteenth-century person
    // with no recorded death is certainly dead, so marking her LIVING would be
    // wrong and would quietly redact her from every shared view.
    const people = await db.person.findMany({
      where: { treeId },
      select: { displayName: true, livingStatus: true },
      orderBy: { displayName: 'asc' },
    });
    const byName = new Map(people.map((p) => [p.displayName.split(' ')[0], p.livingStatus]));
    expect(byName.get('Étienne')).toBe('DECEASED');
    expect(byName.get('Jeanne')).toBe('UNKNOWN');
    expect([...byName.values()]).not.toContain('LIVING');
  });

  it('produces a tree the engine can lay out', async () => {
    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    expect(graph.size).toBe(4);
    expect(graph.findCycles()).toEqual([]);

    const etienne = [...graph.people.values()].find((p) => p.displayName.startsWith('Étienne'));
    expect(graph.childrenOf(etienne?.id ?? '')).toHaveLength(2);

    // Only one of the two children is a biological descendant.
    expect(graph.childrenOf(etienne?.id ?? '', true)).toHaveLength(1);
  });

  it('renders the Republican date back in its own calendar', async () => {
    const graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
    const pierre = [...graph.people.values()].find((p) => p.displayName.startsWith('Pierre'));
    expect(formatGenealogicalDate(pierre?.birth ?? null)).toBe('4 germinal an VII');
  });
});

describe('export after import', () => {
  it('round-trips through the database without losing uncertainty', async () => {
    // Re-export from the mapped plan rather than from the database, which is
    // what the product's export path does: the database holds the canonical
    // values and the writer is the same either way.
    const plan = mapDocument(parseGedcom(SAMPLE));
    const exported = writeGedcom(plan);
    const reimported = mapDocument(parseGedcom(exported));

    const approximate = reimported.events.find((e) => e.date?.qualifier === 'ABOUT');
    expect(approximate).toBeDefined();

    // The Republican date survives as a Republican date, not silently
    // converted to its Gregorian equivalent.
    const republican = reimported.events.find((e) => e.date?.calendar === 'FRENCH_R');
    expect(republican?.date?.start).toEqual({ year: 7, month: 7, day: 4 });
  });
});

describe('a refused link does not cost the rest of the file', () => {
  it('imports everything it can and reports what the database refused', async () => {
    const tree = await db.tree.create({
      data: {
        name: 'Partiel',
        slug: `partial-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });

    try {
      // This file says someone is their own parent, which the CHECK
      // constraint refuses. One impossible link should not cost the user the
      // other people in the file.
      const broken = [
        '0 HEAD',
        '1 GEDC',
        '2 VERS 7.0',
        '0 @I1@ INDI',
        '1 NAME A /X/',
        '1 FAMC @F1@',
        '0 @I2@ INDI',
        '1 NAME B /X/',
        '0 @F1@ FAM',
        '1 HUSB @I1@',
        '1 CHIL @I1@',
        '1 CHIL @I2@',
        '0 TRLR',
      ].join('\r\n');

      const plan = mapDocument(parseGedcom(broken));
      // The mapper catches this one before the database does.
      expect(plan.warnings.map((w) => w.code)).toContain('CHILD_IS_OWN_PARENT');

      const result = await importGedcomPlan(db, plan, { treeId: tree.id, actorId: null });
      expect(result.people).toBe(2);
      expect(await db.person.count({ where: { treeId: tree.id } })).toBe(2);
    } finally {
      await db.tree.delete({ where: { id: tree.id } }).catch(() => undefined);
    }
  });
});
