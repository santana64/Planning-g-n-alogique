import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dateToJdn, gregorianToJdn, wasAliveOn } from '@chronolignee/domain';
import {
  DEFAULT_DUPLICATE_THRESHOLD,
  DUPLICATE_SCORER_VERSION,
  auditTree,
  type Finding,
  type GenealogyGraph,
} from '@chronolignee/genealogy';
import { createDatabase, loadGenealogyGraph, type Database } from '../src/index';

/**
 * The demonstration tree, checked against the engines that are supposed to
 * understand it.
 *
 * This is the test that would catch a regression nobody else would: the seed
 * plants specific difficult cases, and if the domain, the projection or the
 * validator stops handling one of them, the corresponding assertion here fails
 * even though every unit test still passes.
 *
 * Requires `pnpm db:seed`.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const TODAY_JDN = dateToJdn(new Date());
const DEMO_SLUG = 'famille-chassagne-demo';

let db: Database;
let treeId: string;
let graph: GenealogyGraph;
let findings: Finding[];

function personNamed(fragment: string) {
  for (const person of graph.people.values()) {
    if (person.displayName.includes(fragment)) return person;
  }
  throw new Error(`Aucune personne nommée « ${fragment} » dans l'arbre de démonstration`);
}

function findingsFor(code: string): Finding[] {
  return findings.filter((f) => f.code === code);
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.findUnique({ where: { slug: DEMO_SLUG } });
  if (!tree) throw new Error('Arbre de démonstration absent. Lancez `pnpm db:seed`.');
  treeId = tree.id;

  graph = await loadGenealogyGraph(db, treeId, TODAY_JDN);
  findings = auditTree(graph, { todayJdn: TODAY_JDN });
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

describe('shape', () => {
  it('spans eleven generations across two continents', () => {
    expect(graph.size).toBe(40);
  });

  it('has exactly one unattached record, and it is the duplicate candidate', () => {
    // A duplicate lifted from an associative index has no relationships yet —
    // that is what makes it a duplicate rather than a second person. The audit
    // should say so instead of pretending the tree is one clean component.
    const components = graph.components().sort((a, b) => b.length - a.length);
    expect(components).toHaveLength(2);
    expect(components[1]).toHaveLength(1);

    const orphanId = components[1]?.[0];
    expect(graph.people.get(orphanId ?? '')?.displayName).toContain('CHASSAIGNE');
    expect(findingsFor('DISCONNECTED_COMPONENT')).toHaveLength(1);
  });

  it('contains no ancestry cycles', () => {
    expect(graph.findCycles()).toEqual([]);
  });
});

describe('the planted anomaly is found', () => {
  it('flags a mother of 58 as a warning, never as an error', () => {
    const victoire = personNamed('Victoire');
    const tooOld = findingsFor('MOTHER_TOO_OLD');

    expect(tooOld.length).toBeGreaterThan(0);
    const hers = tooOld.find((f) => f.entities.some((e) => e.id === victoire.id));
    expect(hers).toBeDefined();
    expect(hers?.severity).toBe('WARNING');
    // 57, not 58: Victoire was born in July and Hippolyte in February, so
    // her birthday had not come round yet. Dividing a day count by an average
    // year length says 58, which is exactly the error calendar arithmetic
    // exists to avoid.
    expect(hers?.params?.['age']).toBe(57);
  });

  it('produces no blocking errors anywhere in the tree', () => {
    // The demo data is unusual in places and wrong in none. A single ERROR
    // here would mean either the seed writes corrupt data or the validator
    // has started refusing legitimate genealogy.
    const errors = findings.filter((f) => f.severity === 'ERROR');
    expect(errors.map((e) => `${e.code}: ${e.entities.map((x) => x.label).join(' / ')}`)).toEqual(
      [],
    );
  });
});

describe('uncertainty survives the round trip', () => {
  it('leaves a life with no recorded death open-ended, with an inferred bound', () => {
    const henriette = personNamed('Henriette');
    const row = graph.people.get(henriette.id);
    expect(row?.death?.interval).toEqual({ earliest: null, latest: null });
    // The lifespan still has an upper bound, from the maximum-lifespan rule.
    expect(row?.lifespan?.latest).not.toBeNull();
  });

  it('keeps an unreadable register entry verbatim and positions it from the accepted claim', async () => {
    const event = await db.event.findFirst({
      where: { treeId, type: 'BIRTH', dateUnparsed: true },
      select: { dateOriginalText: true, dateEarliestJdn: true },
    });

    // The register said "9 br 1889" and we could not parse it, so the event
    // carries no position at all rather than an invented one.
    expect(event?.dateOriginalText).toBe('9 br 1889');
    expect(event?.dateEarliestJdn).toBeNull();

    // The human reading lives in an accepted claim, and that is what places
    // her on the timeline.
    const leonie = personNamed('Léonie');
    expect(graph.people.get(leonie.id)?.birth?.interval.earliest).toBe(gregorianToJdn(1889, 11, 9));
  });

  it('places a Republican-calendar act correctly', () => {
    const pierre = personNamed('Pierre');
    // 4 germinal an VII = 24 March 1799.
    expect(graph.people.get(pierre.id)?.birth?.interval.earliest).toBe(gregorianToJdn(1799, 3, 24));
  });
});

describe('conflicting evidence is preserved, not resolved away', () => {
  it('keeps both birth-year claims for Jean-Baptiste', async () => {
    const claims = await db.claim.findMany({
      where: {
        treeId,
        predicate: 'BIRTH_DATE',
        person: { displayName: { startsWith: 'Jean-Baptiste' } },
      },
      select: { valueText: true, status: true, confidence: true },
      orderBy: { status: 'asc' },
    });

    expect(claims).toHaveLength(2);
    expect(claims.map((c) => c.status).sort()).toEqual(['ACCEPTED', 'DISPUTED']);
    // The accepted one is the civil register, not the census.
    const accepted = claims.find((c) => c.status === 'ACCEPTED');
    expect(accepted?.valueText).toBe('6 JUN 1822');
    expect(accepted?.confidence).toBe('VERY_HIGH');
  });
});

describe('pedigree collapse is counted, not double-counted', () => {
  it('reaches the founding couple twice from the youngest generation', () => {
    const lea = personNamed('Léa');
    const ancestors = graph.ancestorsOf(lea.id, { biologicalOnly: true });

    // The cousin marriage makes every ancestor above Pierre and Victoire
    // reachable by two paths.
    expect(ancestors.implexIds.size).toBeGreaterThan(0);

    // Collapse propagates: the doubling starts at Pierre and Victoire and
    // reaches every ancestor above them, all the way to the 1702 generation.
    const mathurin = personNamed('Mathurin');
    expect(ancestors.implexIds.has(mathurin.id)).toBe(true);
    expect(ancestors.multiplicity.get(mathurin.id)).toBe(2);

    // Counted once in the ancestor list despite occupying two slots. This is
    // the distinction that keeps "how many ancestors" truthful.
    expect(ancestors.order.filter((id) => id === mathurin.id)).toHaveLength(1);

    const distinct = ancestors.depthById.size;
    const slots = [...ancestors.multiplicity.values()].reduce((a, b) => a + b, 0);
    expect(slots).toBeGreaterThan(distinct);
  });
});

describe('adoption sits alongside biological parentage', () => {
  it('gives the adopted daughter two adoptive parents and no biological ones', () => {
    const sylvie = personNamed('Sylvie');
    const parents = graph.parentsOf(sylvie.id);
    expect(parents).toHaveLength(2);
    expect(parents.every((p) => p.type === 'PARENT_ADOPTIVE')).toBe(true);
    // She has adoptive ancestry in the tree but no genetic line.
    expect(graph.parentsOf(sylvie.id, true)).toHaveLength(0);
  });
});

describe('who was alive', () => {
  const VE_DAY = gregorianToJdn(1945, 5, 8);

  it('separates certain from possible from undated', () => {
    let certain = 0;
    let possible = 0;
    let undated = 0;

    for (const person of graph.people.values()) {
      const answer = wasAliveOn(
        { birth: person.birth, death: person.death, isDeceased: person.isDeceased ?? undefined },
        VE_DAY,
        TODAY_JDN,
      );
      if (answer === 'YES') certain += 1;
      else if (answer === 'MAYBE') {
        const hasDates = person.birth?.interval.earliest !== null;
        if (hasDates) possible += 1;
        else undated += 1;
      }
    }

    // The exact counts matter less than the shape of the answer: the product
    // must never collapse these three groups into one number.
    expect(certain).toBeGreaterThan(0);
    expect(certain + possible + undated).toBeLessThan(graph.size);
    expect(certain).toBeLessThan(graph.size);
  });

  it('excludes someone born long after the date', () => {
    const lea = personNamed('Léa');
    const person = graph.people.get(lea.id);
    expect(
      wasAliveOn(
        { birth: person?.birth, death: person?.death, isDeceased: false },
        VE_DAY,
        TODAY_JDN,
      ),
    ).toBe('NO');
  });

  it('excludes an eighteenth-century ancestor by the maximum-lifespan rule', () => {
    const mathurin = personNamed('Mathurin');
    const person = graph.people.get(mathurin.id);
    expect(
      wasAliveOn(
        { birth: person?.birth, death: person?.death, isDeceased: true },
        VE_DAY,
        TODAY_JDN,
      ),
    ).toBe('NO');
  });
});

describe('the duplicate is surfaced and left alone', () => {
  it('records the pair with an explanation rather than merging it', async () => {
    const candidate = await db.duplicateCandidate.findFirst({
      where: { treeId },
      select: {
        score: true,
        status: true,
        explanation: true,
        leftId: true,
        rightId: true,
        scorerVersion: true,
      },
    });

    expect(candidate?.status).toBe('OPEN');
    expect(candidate?.score).toBeGreaterThan(0.8);
    // Both people still exist: nothing was merged automatically.
    expect(graph.has(candidate?.leftId ?? '')).toBe(true);
    expect(graph.has(candidate?.rightId ?? '')).toBe(true);

    // The row comes from the real scanner, in the shape the review screen
    // reads. The seed once wrote an explanation of its own invention, with a
    // `score` per signal instead of a `value`, and the screen — which reads
    // `value` — displayed "aucun signal net" under a 87 % match.
    expect(candidate?.scorerVersion).toBe(DUPLICATE_SCORER_VERSION);
    const explanation = candidate?.explanation as {
      threshold?: unknown;
      signals?: Array<{ name?: unknown; value?: unknown; weight?: unknown }>;
    };
    expect(explanation?.threshold).toBe(DEFAULT_DUPLICATE_THRESHOLD);
    expect(explanation?.signals?.length).toBeGreaterThan(3);
    expect(
      explanation?.signals?.every(
        (signal) =>
          typeof signal.name === 'string' &&
          typeof signal.value === 'number' &&
          typeof signal.weight === 'number',
      ),
    ).toBe(true);
  });
});

describe('geography', () => {
  it('stores real coordinates and answers a spatial question', async () => {
    const rows = await db.$queryRaw<Array<{ km: number }>>`
      SELECT ST_Distance(
               (SELECT geom FROM places WHERE "treeId" = ${treeId}::uuid AND name = 'Tours'),
               (SELECT geom FROM places WHERE "treeId" = ${treeId}::uuid AND name = 'Buenos Aires')
             ) / 1000 AS km`;

    // Tours to Buenos Aires is roughly 11 000 km. The migration is a real
    // distance on a real globe, not a line between two labels.
    expect(rows[0]?.km).toBeGreaterThan(10_500);
    expect(rows[0]?.km).toBeLessThan(11_500);
  });

  it('keeps the historical name of a place that was renamed', async () => {
    const place = await db.place.findFirst({
      where: { treeId, name: 'Indre-et-Loire' },
      select: { historicalName: true },
    });
    // An act of 1750 says Touraine; a modern geocoder would say Indre-et-Loire.
    // Overwriting the former would falsify the source.
    expect(place?.historicalName).toBe('Touraine');
  });
});
