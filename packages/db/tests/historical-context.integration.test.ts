import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gregorianToJdn } from '@chronolignee/domain';
import { createDatabase, loadHistoricalContext, type Database } from '../src/index';

/**
 * Every tree has its history without anyone curating it: the catalogue's
 * events over its span, in its countries, plus the world, plus what a member
 * pinned. Requires the catalogue migration.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
const span = (from: number, to: number) => ({
  fromJdn: gregorianToJdn(from, 1, 1),
  toJdn: gregorianToJdn(to, 12, 31),
});

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });
  treeId = (
    await db.tree.create({
      data: {
        name: 'Contexte',
        slug: `context-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('loadHistoricalContext', () => {
  it('gives a new tree with no place the French and world events over its span', async () => {
    const titles = (await loadHistoricalContext(db, treeId, span(1910, 1920))).map((e) => e.title);
    expect(titles).toContain('Première Guerre mondiale');
    expect(titles).toContain('Bataille de Verdun');
    expect(titles).not.toContain('Loi Sáenz Peña');
    expect(titles).not.toContain('Révolution française');
  });

  it('adds a country’s history once the tree has a place there', async () => {
    await db.place.create({ data: { treeId, name: 'Buenos Aires', countryCode: 'AR' } });
    const titles = (await loadHistoricalContext(db, treeId, span(1910, 1920))).map((e) => e.title);
    expect(titles).toContain('Loi Sáenz Peña');
    // France is no longer assumed: this tree is located, in Argentina.
    expect(titles).not.toContain('Bataille de Verdun');
    // Argentina stayed neutral: the war is its belligerents' context…
    expect(titles).not.toContain('Première Guerre mondiale');
    // …while a pandemic that went round the world is everyone's.
    expect(titles).toContain('Grippe espagnole');
  });

  it('keeps an event a member pinned, whatever its dates', async () => {
    const event = await db.historicalEvent.findFirstOrThrow({
      where: { title: 'Révolution française' },
      select: { id: true },
    });
    await db.treeHistoricalEvent.create({
      data: { treeId, historicalEventId: event.id, pinned: true },
    });
    const context = await loadHistoricalContext(db, treeId, span(1910, 1920));
    expect(context.find((e) => e.title === 'Révolution française')?.pinned).toBe(true);
  });
});
