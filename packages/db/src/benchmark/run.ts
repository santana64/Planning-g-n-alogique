import { randomUUID } from 'node:crypto';
import { cpus, platform, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { dateToJdn, parseGenealogicalDate } from '@chronolignee/domain';
import { mapDocument, parseGedcom, writeGedcom } from '@chronolignee/gedcom';
import { syntheticFamily, type SyntheticFamily } from '@chronolignee/genealogy/synthetic';
import { createDatabase, type Database } from '../client';
import { encodeDate } from '../date-codec';
import {
  buildDisplayForm,
  buildSearchName,
  normaliseGiven,
  normalisePlaceName,
  normaliseSurname,
} from '../normalise';
import { lifespanColumns, projectPersonLifespan } from '../projections/person-lifespan';
import { loadAtlas } from '../repositories/atlas';
import { loadEvidenceCoverage } from '../repositories/evidence-coverage';
import { buildGedcomPlan } from '../repositories/gedcom-export';
import { loadGenealogyGraph } from '../repositories/graph';
import { scanDuplicates } from '../services/duplicates';
import { searchPeople } from '../repositories/search';
import { importGedcomPlan } from '../services/import-gedcom';

/**
 * The database side of every view, on synthetic trees of 1 000 to 20 000.
 *
 *   pnpm benchmark:db        # needs the local infrastructure (pnpm infra:up)
 *
 * Each size is written as a tree of its own — people with their names, birth
 * and death events with places, parent and spouse links — measured, then
 * deleted. Never point this at a production database: it writes.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const SIZES = (process.env['BENCHMARK_SIZES'] ?? '1000,5000,20000')
  .split(',')
  .map((size) => Number(size.trim()))
  .filter((size) => Number.isFinite(size) && size > 0);
const TODAY_JDN = dateToJdn(new Date());
const BATCH = 5_000;

interface Measure {
  readonly size: number;
  readonly operation: string;
  readonly medianMs: number;
  readonly worstMs: number;
}

async function inBatches<T>(rows: readonly T[], write: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH) {
    await write(rows.slice(start, start + BATCH));
  }
}

/** Write a synthetic family as a tree; returns the tree's id. */
async function writeTree(db: Database, family: SyntheticFamily, size: number): Promise<string> {
  const tree = await db.tree.create({
    data: { name: `Banc d’essai ${size}`, slug: `benchmark-${size}-${Date.now()}` },
    select: { id: true },
  });
  const treeId = tree.id;

  const placeIds = family.places.map(() => randomUUID());
  await db.place.createMany({
    data: family.places.map((place, index) => ({
      id: placeIds[index] as string,
      treeId,
      name: place.name,
      normalisedName: normalisePlaceName(place.name),
      type: 'CITY' as const,
      latitude: place.latitude,
      longitude: place.longitude,
      countryCode: place.countryCode,
    })),
  });

  const personIds = new Map<string, string>();
  const people = [];
  const names = [];
  const events = [];
  const participants = [];
  for (const person of family.people) {
    const id = randomUUID();
    personIds.set(person.id, id);
    const livingStatus = person.living ? ('LIVING' as const) : ('UNKNOWN' as const);
    const vital = (
      [
        ['BIRTH', person.birthText],
        ['DEATH', person.deathText],
      ] as const
    ).flatMap(([type, text]) =>
      text ? [{ type, date: encodeDate(parseGenealogicalDate(text)) }] : [],
    );
    const projection = projectPersonLifespan(
      {
        livingStatus,
        events: vital.map((event) => ({ type: event.type, ...event.date })),
        claims: [],
      },
      TODAY_JDN,
    );
    const name = { given: person.given, surname: person.surname };
    people.push({
      id,
      treeId,
      displayName: buildDisplayForm(name),
      searchName: buildSearchName(name),
      recordedSex: person.recordedSex,
      livingStatus,
      privacy: person.living ? ('REDACTED' as const) : ('INHERIT' as const),
      ...lifespanColumns(projection),
    });
    names.push({
      treeId,
      personId: id,
      type: 'BIRTH' as const,
      given: person.given,
      surname: person.surname,
      normalisedSurname: normaliseSurname(person.surname),
      normalisedGiven: normaliseGiven(person.given),
      displayForm: buildDisplayForm(name),
      isPreferred: true,
    });
    for (const event of vital) {
      const eventId = randomUUID();
      events.push({
        id: eventId,
        treeId,
        type: event.type,
        ...event.date,
        placeId: event.type === 'BIRTH' ? placeIds[person.birthPlace] : null,
      });
      participants.push({ eventId, personId: id, role: 'PRINCIPAL' as const });
    }
  }

  await inBatches(people, (batch) => db.person.createMany({ data: batch }));
  await inBatches(names, (batch) => db.personName.createMany({ data: batch }));
  await inBatches(events, (batch) => db.event.createMany({ data: batch }));
  await inBatches(participants, (batch) => db.eventParticipant.createMany({ data: batch }));
  await inBatches(
    family.links.map((link) => ({
      treeId,
      sourceId: personIds.get(link.sourceId) as string,
      targetId: personIds.get(link.targetId) as string,
      type: link.type,
    })),
    (batch) => db.relationship.createMany({ data: batch }),
  );
  return treeId;
}

async function time(runs: number, work: () => Promise<unknown>) {
  await work();
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    await work();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)] ?? 0,
    worst: samples[samples.length - 1] ?? 0,
  };
}

async function benchmark(db: Database, size: number): Promise<Measure[]> {
  const family = syntheticFamily({ size });
  const writeStarted = performance.now();
  const treeId = await writeTree(db, family, size);
  const writeMs = performance.now() - writeStarted;
  const results: Measure[] = [
    { size, operation: 'Écriture de l’arbre (createMany)', medianMs: writeMs, worstMs: writeMs },
  ];
  const runs = size <= 5_000 ? 7 : 5;
  const record = async (operation: string, work: () => Promise<unknown>) => {
    const { median, worst } = await time(runs, work);
    results.push({ size, operation, medianMs: median, worstMs: worst });
  };

  try {
    await record('Chargement du graphe entier', () => loadGenealogyGraph(db, treeId, TODAY_JDN));
    await record('Recherche par nom (trigrammes)', () =>
      searchPeople(db, { treeId, query: 'mart', limit: 24 }),
    );
    await record('Liste : première page + total', () =>
      Promise.all([
        db.person.findMany({
          where: { treeId, deletedAt: null },
          orderBy: [{ birthSortJdn: { sort: 'asc', nulls: 'last' } }, { displayName: 'asc' }],
          take: 61,
          select: { id: true, displayName: true, lifespanEarliestJdn: true },
        }),
        db.person.count({ where: { treeId, deletedAt: null } }),
      ]),
    );
    await record('Carte (lieux et trajets)', () =>
      loadAtlas(db, { treeId, isHidden: () => false }),
    );
    await record('Couverture des sources', () => loadEvidenceCoverage(db, treeId));
    // The duplicate scan reads the whole tree and joins it against itself
    // through the trigram index: the one query whose cost is not obvious.
    // Timed once per size — it writes rows — and its candidates are dropped
    // with the tree.
    const scanStarted = performance.now();
    const scan = await scanDuplicates(db, { treeId, todayJdn: TODAY_JDN });
    const scanMs = performance.now() - scanStarted;
    results.push({
      size,
      operation: `Recherche de doublons (${scan.examined} paires examinées)`,
      medianMs: scanMs,
      worstMs: scanMs,
    });
    await record('Export GEDCOM (lecture + écriture)', async () =>
      writeGedcom(await buildGedcomPlan(db, treeId)),
    );

    // The same tree back in through the import: parsed, mapped, then written
    // in one transaction. Timed once — it writes — and allowed to fail, which
    // is itself the finding when it does.
    const file = writeGedcom(await buildGedcomPlan(db, treeId));
    const parseStarted = performance.now();
    const plan = mapDocument(parseGedcom(file));
    const parseMs = performance.now() - parseStarted;
    results.push({
      size,
      operation: 'Import GEDCOM : lecture',
      medianMs: parseMs,
      worstMs: parseMs,
    });
    const target = await db.tree.create({
      data: { name: `Import ${size}`, slug: `benchmark-import-${size}-${Date.now()}` },
      select: { id: true },
    });
    try {
      const importStarted = performance.now();
      await importGedcomPlan(db, plan, { treeId: target.id, actorId: null });
      const importMs = performance.now() - importStarted;
      results.push({
        size,
        operation: 'Import GEDCOM : écriture',
        medianMs: importMs,
        worstMs: importMs,
      });
    } catch (error) {
      results.push({
        size,
        operation: 'Import GEDCOM : écriture',
        medianMs: Number.NaN,
        worstMs: Number.NaN,
      });
      process.stderr.write(
        `Import GEDCOM de ${size} personnes : échec (${error instanceof Error ? error.message.split('\n')[0] : String(error)})\n`,
      );
    } finally {
      await db.tree.delete({ where: { id: target.id } });
    }
  } finally {
    await db.tree.delete({ where: { id: treeId } });
  }
  return results;
}

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required: start the infrastructure with pnpm infra:up');
const db = createDatabase({ url });

const all: Measure[] = [];
try {
  for (const size of SIZES) {
    all.push(...(await benchmark(db, size)));
    process.stderr.write(`${size} personnes mesurées\n`);
  }
} finally {
  await db.$disconnect();
}

const postgres = await (async () => {
  const again = createDatabase({ url });
  try {
    const rows = await again.$queryRawUnsafe<{ version: string }[]>(
      "SELECT current_setting('server_version') AS version",
    );
    return rows[0]?.version ?? '?';
  } finally {
    await again.$disconnect();
  }
})();

const format = (ms: number) => (ms < 10 ? ms.toFixed(2) : ms.toFixed(0));
const operations = [...new Set(all.map((measure) => measure.operation))];
const cpu = cpus()[0]?.model.trim() ?? 'unknown CPU';
process.stdout.write(
  [
    `Environnement : Node ${process.version} · PostgreSQL ${postgres} (Docker) · ${platform()} ${release()} · ${cpu} × ${cpus().length} · ${Math.round(totalmem() / 1024 ** 3)} Go`,
    '',
    `| Opération | ${SIZES.map((size) => `${size.toLocaleString('fr-FR')} pers.`).join(' | ')} |`,
    `| --- | ${SIZES.map(() => '---:').join(' | ')} |`,
    ...operations.map((operation) => {
      const cells = SIZES.map((size) => {
        const measure = all.find((m) => m.size === size && m.operation === operation);
        if (!measure) return '—';
        if (Number.isNaN(measure.medianMs)) return 'échec';
        return measure.medianMs === measure.worstMs
          ? format(measure.medianMs)
          : `${format(measure.medianMs)} (${format(measure.worstMs)})`;
      });
      return `| ${operation} | ${cells.join(' | ')} |`;
    }),
    '',
    'Médiane (pire) en millisecondes ; l’écriture est mesurée une fois.',
    '',
  ].join('\n'),
);
