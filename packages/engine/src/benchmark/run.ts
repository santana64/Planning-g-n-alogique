import { cpus, platform, release, totalmem } from 'node:os';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  MAX_PLAUSIBLE_LIFESPAN_YEARS,
  dateToJdn,
  parseGenealogicalDate,
  type GenealogicalDate,
} from '@chronolignee/domain';
import {
  GenealogyGraph,
  auditTree,
  sosaNumbers,
  type GraphEdge,
  type GraphPerson,
} from '@chronolignee/genealogy';
import { syntheticFamily, type SyntheticFamily } from '@chronolignee/genealogy/synthetic';
import { layoutConstellation } from '../layout/constellation';
import { ganttLinks, layoutGantt } from '../layout/gantt';
import { layoutTemporalFan, type FanAncestor } from '../layout/temporal-fan';

/**
 * The engine, timed on synthetic trees of 100 to 20 000 people.
 *
 * In-memory work only — what runs on every request for a view, after the
 * database has answered. The database side is `pnpm benchmark:db`.
 *
 *   pnpm benchmark                  # all sizes, a table on stdout
 *   pnpm benchmark -- --json out.json
 *
 * Each operation runs twice to warm up, then enough times for a median and a
 * worst case worth reading. Results and the machine they came from go into
 * docs/PERFORMANCE.md by hand: numbers without their environment mislead.
 */

const SIZES = [100, 1_000, 5_000, 20_000] as const;
const TODAY_JDN = dateToJdn(new Date());
const DAYS_PER_YEAR = 365.2425;

interface Measure {
  readonly size: number;
  readonly operation: string;
  readonly medianMs: number;
  readonly worstMs: number;
  readonly runs: number;
  readonly note: string;
}

function parsed(text: string | null): GenealogicalDate | null {
  return text ? parseGenealogicalDate(text) : null;
}

/** A synthetic family as the people and links of the graph the views are drawn from. */
function toGraphInput(family: SyntheticFamily): { people: GraphPerson[]; edges: GraphEdge[] } {
  const people: GraphPerson[] = family.people.map((person) => {
    const birth = parsed(person.birthText);
    const death = parsed(person.deathText);
    const start = birth?.interval.earliest ?? null;
    const end =
      death?.interval.latest ??
      (person.living
        ? TODAY_JDN
        : start !== null
          ? Math.round(start + MAX_PLAUSIBLE_LIFESPAN_YEARS * DAYS_PER_YEAR)
          : null);
    return {
      id: person.id,
      displayName: `${person.given} ${person.surname.toUpperCase()}`,
      recordedSex: person.recordedSex,
      birth,
      death,
      lifespan: { earliest: start, latest: end },
      isDeceased: person.living ? false : death ? true : null,
      livingStatus: person.living ? 'LIVING' : death ? 'DECEASED' : 'UNKNOWN',
      privacy: 'INHERIT',
      deathRecorded: death !== null,
    };
  });
  const edges: GraphEdge[] = family.links.map((link, index) => ({
    id: `r${index}`,
    sourceId: link.sourceId,
    targetId: link.targetId,
    type: link.type,
  }));
  return { people, edges };
}

function time(runs: number, work: () => unknown): { median: number; worst: number } {
  for (let warm = 0; warm < 2; warm += 1) work();
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    work();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)] ?? 0,
    worst: samples[samples.length - 1] ?? 0,
  };
}

function benchmark(size: number): Measure[] {
  const family = syntheticFamily({ size });
  const runs = size <= 1_000 ? 30 : size <= 5_000 ? 12 : 6;
  const results: Measure[] = [];
  const record = (operation: string, work: () => unknown, note = '') => {
    const { median, worst } = time(runs, work);
    results.push({ size, operation, medianMs: median, worstMs: worst, runs, note });
  };

  record('Lecture des dates (naissance, décès)', () => toGraphInput(family));
  const input = toGraphInput(family);
  record('Construction du graphe', () => new GenealogyGraph(input.people, input.edges));
  const graph = new GenealogyGraph(input.people, input.edges);

  // The worst cases a view meets: the person with the largest ancestry, and
  // the founder with the widest descent. A spouse
  // who married in has no ancestry here, and a founder may have had no
  // children, so neither is chosen by position.
  let youngest = family.people[0];
  let reachUp = -1;
  for (const candidate of family.people) {
    if (graph.parentsOf(candidate.id).length === 0) continue;
    const reach = graph.ancestorsOf(candidate.id).order.length;
    if (reach > reachUp) {
      reachUp = reach;
      youngest = candidate;
    }
  }
  let founder = family.people[0];
  let widest = -1;
  for (const candidate of family.people.filter((person) => person.generation === 0)) {
    const reach = graph.descendantsOf(candidate.id).order.length;
    if (reach > widest) {
      widest = reach;
      founder = candidate;
    }
  }
  if (!youngest || !founder) throw new Error('empty synthetic family');

  record('Ascendance complète', () => graph.ancestorsOf(youngest.id), `${reachUp} personnes`);
  record('Descendance complète', () => graph.descendantsOf(founder.id), `${widest} personnes`);
  record('Numérotation Sosa (12 gén.)', () => sosaNumbers(graph, youngest.id, { generations: 12 }));

  const gantt = layoutGantt(graph);
  record('Frise (Gantt) : mise en page', () => layoutGantt(graph));
  record('Frise (Gantt) : liens', () => ganttLinks(graph, gantt));

  // "Who was alive" is an interval test over every person, run on each move
  // of the time cursor.
  const lifespans = [...graph.people.values()].map((person) => person.lifespan);
  const probe = dateToJdn(new Date(Date.UTC(1900, 0, 1)));
  record('Qui était vivant (1 date)', () => {
    let certain = 0;
    for (const lifespan of lifespans) {
      if (
        lifespan?.earliest != null &&
        lifespan.latest != null &&
        lifespan.earliest <= probe &&
        probe <= lifespan.latest
      ) {
        certain += 1;
      }
    }
    return certain;
  });

  const constellationPeople = [...graph.people.values()].map((person) => ({
    id: person.id,
    birthSortJdn: person.birth?.interval.earliest ?? null,
    recordedSex: person.recordedSex ?? null,
  }));
  const constellationLinks = family.links.map((link) => ({
    from: link.sourceId,
    to: link.targetId,
    kind: link.type === 'SPOUSE' ? ('PARTNER' as const) : ('PARENT' as const),
  }));
  record('Constellation (6 sauts, ≤ 2 000)', () =>
    layoutConstellation(youngest.id, constellationPeople, constellationLinks, {
      maxHops: 6,
      maxPeople: 2_000,
    }),
  );

  const sosa = sosaNumbers(graph, youngest.id, { generations: 10 });
  const ancestors: FanAncestor[] = [];
  for (const [number, personId] of sosa.personByNumber) {
    const birth = graph.people.get(personId)?.birth;
    ancestors.push({
      personId,
      sosa: number,
      birthEarliestJdn: birth?.interval.earliest ?? null,
      birthLatestJdn: birth?.interval.latest ?? null,
    });
  }
  const subjectBirth = graph.people.get(youngest.id)?.birth;
  record('Éventail temporel (10 gén.)', () =>
    layoutTemporalFan(
      {
        birthEarliestJdn: subjectBirth?.interval.earliest ?? null,
        birthLatestJdn: subjectBirth?.interval.latest ?? null,
      },
      ancestors,
    ),
  );

  record('Audit de l’arbre (anomalies)', () => auditTree(graph, { todayJdn: TODAY_JDN }));

  return results;
}

function environment(): string {
  const cpu = cpus()[0]?.model.trim() ?? 'unknown CPU';
  return [
    `Node ${process.version}`,
    `${platform()} ${release()}`,
    `${cpu} × ${cpus().length}`,
    `${Math.round(totalmem() / 1024 ** 3)} Go de mémoire`,
  ].join(' · ');
}

const all: Measure[] = [];
for (const size of SIZES) {
  const started = performance.now();
  all.push(...benchmark(size));
  process.stderr.write(`${size} personnes : ${Math.round(performance.now() - started)} ms\n`);
}

const format = (ms: number) => (ms < 1 ? ms.toFixed(3) : ms < 10 ? ms.toFixed(2) : ms.toFixed(1));
const operations = [...new Set(all.map((measure) => measure.operation))];
const lines = [
  `Environnement : ${environment()}`,
  '',
  `| Opération | ${SIZES.map((size) => `${size.toLocaleString('fr-FR')} pers.`).join(' | ')} |`,
  `| --- | ${SIZES.map(() => '---:').join(' | ')} |`,
  ...operations.map((operation) => {
    const cells = SIZES.map((size) => {
      const measure = all.find((m) => m.size === size && m.operation === operation);
      return measure ? `${format(measure.medianMs)} (${format(measure.worstMs)})` : '—';
    });
    return `| ${operation} | ${cells.join(' | ')} |`;
  }),
  '',
  'Médiane (pire) en millisecondes.',
  '',
  ...SIZES.flatMap((size) =>
    all
      .filter((measure) => measure.size === size && measure.note)
      .map((measure) => `- ${size} pers., ${measure.operation} : ${measure.note}`),
  ),
];
process.stdout.write(`${lines.join('\n')}\n`);

const jsonIndex = process.argv.indexOf('--json');
const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ environment: environment(), results: all }, null, 2));
}
