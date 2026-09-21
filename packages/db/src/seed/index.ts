import { fileURLToPath } from 'node:url';
import { dateToJdn, parseGenealogicalDate, type GenealogicalDate } from '@chronolignee/domain';
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
import { scanDuplicates } from '../services/duplicates';
import {
  CONFLICTING_CLAIMS,
  EXTRA_PARENT_LINKS,
  HISTORICAL_EVENTS,
  LIFE_EVENTS,
  PEOPLE,
  PLACES,
  SOURCES,
  UNIONS,
  type SeedPerson,
} from './demo-family';

/**
 * Seeds the demonstration genealogy.
 *
 * Writes through Prisma directly rather than through the application services.
 * That is deliberate for a fixture builder — it needs to be fast and
 * transactional — but it uses the same domain helpers for date parsing, name
 * normalisation and lifespan projection, so the derived columns it produces are
 * identical to the ones an ordinary edit would produce. A seed that took a
 * shortcut on those would hide bugs rather than expose them.
 *
 * Safe to run repeatedly: the demo tree is deleted and rebuilt, and nothing
 * else in the database is touched.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const DEMO_SLUG = 'famille-chassagne-demo';
const TODAY_JDN = dateToJdn(new Date());

type Ids = Map<string, string>;

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

function parse(text: string | undefined): GenealogicalDate | null {
  return text ? parseGenealogicalDate(text) : null;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');

  const db = createDatabase({ url });

  try {
    const owner = await resolveOwner(db);
    await db.tree.deleteMany({ where: { slug: DEMO_SLUG } });

    const tree = await db.tree.create({
      data: {
        name: 'Famille Chassagne (démonstration)',
        slug: DEMO_SLUG,
        description:
          'Famille fictive, 1702-2026, onze générations, deux continents. ' +
          'Contient volontairement des dates approximatives, une date illisible, ' +
          'des sources contradictoires, un doublon et une anomalie à examiner.',
        // Public so the landing page's "voir la démonstration" works without
        // an account, and redacting living people so that public view exercises
        // the privacy path rather than bypassing it.
        visibility: 'PUBLIC',
        redactLivingPeople: true,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    log(`Arbre créé : ${tree.name}`);

    const placeIds = await seedPlaces(db, tree.id);
    const sourceIds = await seedSources(db, tree.id);
    const personIds = await seedPeople(db, tree.id, placeIds, sourceIds);
    await seedUnions(db, tree.id, personIds, placeIds, sourceIds);
    await seedExtraLinks(db, tree.id, personIds);
    await seedLifeEvents(db, tree.id, personIds, placeIds, sourceIds);
    await seedConflictingClaims(db, tree.id, personIds, sourceIds);
    await seedDuplicateCandidate(db, tree.id);
    await seedResearchTasks(db, tree.id, personIds);
    await seedHistoricalEvents(db, tree.id);
    await projectLifespans(db, tree.id);

    await report(db, tree.id);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Attach the demo to a real account when one exists.
 *
 * The seed never creates credentials. If the database has no users yet it
 * creates a placeholder owner with no password, which cannot be signed into —
 * the tree is then transferred when someone registers.
 */
async function resolveOwner(db: Database): Promise<{ id: string; email: string }> {
  const requested = process.env['DEMO_OWNER_EMAIL'];

  if (requested) {
    const user = await db.user.findUnique({ where: { email: requested } });
    if (!user) throw new Error(`Aucun compte pour DEMO_OWNER_EMAIL=${requested}`);
    log(`Propriétaire : ${user.email}`);
    return user;
  }

  const first = await db.user.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (first) {
    log(`Propriétaire : ${first.email} (premier compte existant)`);
    return first;
  }

  const placeholder = await db.user.upsert({
    where: { email: 'demo@chronolignee.local' },
    update: {},
    create: {
      email: 'demo@chronolignee.local',
      name: 'Compte de démonstration',
      emailVerified: false,
    },
  });
  log(
    'Propriétaire : compte de démonstration (sans identifiants). ' +
      "Créez un compte puis relancez le seed pour vous attribuer l'arbre.",
  );
  return placeholder;
}

async function seedPlaces(db: Database, treeId: string): Promise<Ids> {
  const ids: Ids = new Map();

  // Parents first, so the hierarchy can be linked in one pass.
  const ordered = [...PLACES].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));

  for (const place of ordered) {
    const created = await db.place.create({
      data: {
        treeId,
        name: place.name,
        normalisedName: normalisePlaceName(place.name),
        type: place.type,
        ...(place.parent ? { parentId: ids.get(place.parent) } : {}),
        ...(place.latitude !== undefined ? { latitude: place.latitude } : {}),
        ...(place.longitude !== undefined ? { longitude: place.longitude } : {}),
        ...(place.countryCode ? { countryCode: place.countryCode } : {}),
        ...(place.historicalName ? { historicalName: place.historicalName } : {}),
        confidence: 'HIGH',
      },
    });
    ids.set(place.key, created.id);

    // Prisma cannot write an Unsupported column, so the geography point is set
    // in raw SQL. Kept beside the insert rather than in a later pass: a place
    // with coordinates but no geom would be invisible to every spatial query.
    if (place.latitude !== undefined && place.longitude !== undefined) {
      await db.$executeRaw`
        UPDATE places
        SET geom = ST_SetSRID(ST_MakePoint(${place.longitude}, ${place.latitude}), 4326)::geography
        WHERE id = ${created.id}::uuid`;
    }
  }

  log(`${ids.size} lieux`);
  return ids;
}

async function seedSources(db: Database, treeId: string): Promise<Ids> {
  const ids: Ids = new Map();
  for (const source of SOURCES) {
    const created = await db.source.create({
      data: {
        treeId,
        title: source.title,
        type: source.type,
        ...(source.repository ? { repository: source.repository } : {}),
        ...(source.callNumber ? { callNumber: source.callNumber } : {}),
        reliability: source.reliability,
      },
    });
    ids.set(source.key, created.id);
  }
  log(`${ids.size} sources`);
  return ids;
}

async function seedPeople(
  db: Database,
  treeId: string,
  placeIds: Ids,
  sourceIds: Ids,
): Promise<Ids> {
  const ids: Ids = new Map();

  for (const person of PEOPLE) {
    const created = await db.person.create({
      data: {
        treeId,
        recordedSex: person.sex,
        livingStatus: person.living ? 'LIVING' : person.death ? 'DECEASED' : 'UNKNOWN',
        // Living people are redacted by default in shared views; the tree-level
        // setting decides, and this marks who it applies to.
        privacy: person.living ? 'REDACTED' : 'INHERIT',
        displayName: buildDisplayForm(person),
        searchName: buildSearchName(person),
        ...(person.notes ? { notes: person.notes } : {}),
      },
    });
    ids.set(person.key, created.id);

    await createNames(db, treeId, created.id, person);
    await createVitalEvents(db, treeId, created.id, person, placeIds, sourceIds);
    await createLifeStateEvents(db, treeId, created.id, person, placeIds);
  }

  log(`${ids.size} personnes`);
  return ids;
}

async function createNames(
  db: Database,
  treeId: string,
  personId: string,
  person: SeedPerson,
): Promise<void> {
  const surname = person.birthSurname ?? person.surname;

  await db.personName.create({
    data: {
      treeId,
      personId,
      type: 'BIRTH',
      given: person.given,
      surname,
      normalisedSurname: normaliseSurname(surname),
      normalisedGiven: normaliseGiven(person.given),
      displayForm: buildDisplayForm({ given: person.given, surname }),
      isPreferred: !person.birthSurname,
      confidence: 'HIGH',
    },
  });

  // A married surname is a second name record with its own validity, not an
  // overwrite. Overwriting would make every pre-marriage document unfindable.
  if (person.birthSurname) {
    await db.personName.create({
      data: {
        treeId,
        personId,
        type: 'MARRIED',
        given: person.given,
        surname: person.surname,
        birthSurname: person.birthSurname,
        normalisedSurname: normaliseSurname(person.surname),
        normalisedGiven: normaliseGiven(person.given),
        displayForm: buildDisplayForm(person),
        isPreferred: true,
        confidence: 'HIGH',
      },
    });
  }
}

async function createVitalEvents(
  db: Database,
  treeId: string,
  personId: string,
  person: SeedPerson,
  placeIds: Ids,
  sourceIds: Ids,
): Promise<void> {
  const birth = parse(person.birth);
  if (birth) {
    const event = await db.event.create({
      data: {
        treeId,
        type: 'BIRTH',
        ...encodeDate(birth),
        ...(person.birthPlace ? { placeId: placeIds.get(person.birthPlace) } : {}),
        confidence: birth.unparsed ? 'LOW' : 'HIGH',
        participants: { create: { personId, role: 'PRINCIPAL' } },
      },
    });

    const sourceId = person.birthSource ? sourceIds.get(person.birthSource) : undefined;
    if (sourceId) {
      await db.citation.create({
        data: { treeId, sourceId, eventId: event.id, confidence: 'HIGH' },
      });
    }
  }

  const death = parse(person.death);
  if (death) {
    await db.event.create({
      data: {
        treeId,
        type: 'DEATH',
        ...encodeDate(death),
        ...(person.deathPlace ? { placeId: placeIds.get(person.deathPlace) } : {}),
        confidence: 'HIGH',
        participants: { create: { personId, role: 'PRINCIPAL' } },
      },
    });
  }
}

async function createLifeStateEvents(
  db: Database,
  treeId: string,
  personId: string,
  person: SeedPerson,
  placeIds: Ids,
): Promise<void> {
  if (person.occupation) {
    // An occupation is a state held over a period, so it is a RANGE date and
    // not a point. The Gantt draws it as a band across those years.
    const date = parse(person.occupationPeriod) ?? null;
    await db.event.create({
      data: {
        treeId,
        type: 'OCCUPATION',
        ...(date ? encodeDate(date) : {}),
        description: person.occupation,
        confidence: 'MEDIUM',
        participants: { create: { personId, role: 'PRINCIPAL' } },
      },
    });
  }

  if (person.residence) {
    const date = parse(person.residence.period);
    await db.event.create({
      data: {
        treeId,
        type: 'RESIDENCE',
        ...(date ? encodeDate(date) : {}),
        placeId: placeIds.get(person.residence.place),
        confidence: 'MEDIUM',
        participants: { create: { personId, role: 'PRINCIPAL' } },
      },
    });
  }
}

async function seedUnions(
  db: Database,
  treeId: string,
  personIds: Ids,
  placeIds: Ids,
  sourceIds: Ids,
): Promise<void> {
  let marriages = 0;
  let relationships = 0;

  for (const union of UNIONS) {
    const [aKey, bKey] = union.spouses;
    const a = personIds.get(aKey);
    const b = personIds.get(bKey);
    if (!a || !b) continue;

    const marriage = parse(union.marriage);
    const divorce = parse(union.divorce);

    await db.relationship.create({
      data: {
        treeId,
        sourceId: a,
        targetId: b,
        type: union.divorce ? 'DIVORCED_PARTNER' : union.partnership ? 'PARTNER' : 'SPOUSE',
        ...(marriage?.interval.earliest !== undefined && marriage?.interval.earliest !== null
          ? { startJdn: marriage.interval.earliest }
          : {}),
        ...(divorce?.interval.latest !== undefined && divorce?.interval.latest !== null
          ? { endJdn: divorce.interval.latest }
          : {}),
        confidence: 'HIGH',
      },
    });
    relationships += 1;

    if (marriage) {
      const event = await db.event.create({
        data: {
          treeId,
          type: 'MARRIAGE',
          ...encodeDate(marriage),
          ...(union.marriagePlace ? { placeId: placeIds.get(union.marriagePlace) } : {}),
          confidence: 'HIGH',
          participants: {
            create: [
              { personId: a, role: 'SPOUSE' },
              { personId: b, role: 'SPOUSE' },
            ],
          },
        },
      });
      marriages += 1;

      const sourceId = union.marriageSource ? sourceIds.get(union.marriageSource) : undefined;
      if (sourceId) {
        await db.citation.create({
          data: { treeId, sourceId, eventId: event.id, confidence: 'HIGH' },
        });
      }
    }

    if (divorce) {
      await db.event.create({
        data: {
          treeId,
          type: 'DIVORCE',
          ...encodeDate(divorce),
          confidence: 'HIGH',
          participants: {
            create: [
              { personId: a, role: 'SPOUSE' },
              { personId: b, role: 'SPOUSE' },
            ],
          },
        },
      });
    }

    for (const childKey of union.children ?? []) {
      const child = personIds.get(childKey);
      if (!child) continue;
      for (const parent of [a, b]) {
        await db.relationship.create({
          data: {
            treeId,
            sourceId: parent,
            targetId: child,
            type: 'PARENT_BIOLOGICAL',
            confidence: 'HIGH',
          },
        });
        relationships += 1;
      }
    }

    for (const childKey of union.adoptedChildren ?? []) {
      const child = personIds.get(childKey);
      if (!child) continue;
      for (const parent of [a, b]) {
        await db.relationship.create({
          data: {
            treeId,
            sourceId: parent,
            targetId: child,
            type: 'PARENT_ADOPTIVE',
            confidence: 'HIGH',
          },
        });
        relationships += 1;
      }
    }
  }

  log(`${relationships} relations, ${marriages} mariages`);
}

async function seedExtraLinks(db: Database, treeId: string, personIds: Ids): Promise<void> {
  for (const link of EXTRA_PARENT_LINKS) {
    const parent = personIds.get(link.parent);
    const child = personIds.get(link.child);
    if (!parent || !child) continue;
    await db.relationship.create({
      data: { treeId, sourceId: parent, targetId: child, type: link.type, confidence: 'HIGH' },
    });
  }
}

async function seedLifeEvents(
  db: Database,
  treeId: string,
  personIds: Ids,
  placeIds: Ids,
  sourceIds: Ids,
): Promise<void> {
  for (const entry of LIFE_EVENTS) {
    const personId = personIds.get(entry.person);
    if (!personId) continue;

    const date = parse(entry.date);
    const event = await db.event.create({
      data: {
        treeId,
        type: entry.type,
        ...(date ? encodeDate(date) : {}),
        ...(entry.place ? { placeId: placeIds.get(entry.place) } : {}),
        description: entry.description,
        confidence: 'MEDIUM',
        participants: { create: { personId, role: 'PRINCIPAL' } },
      },
    });

    const sourceId = entry.source ? sourceIds.get(entry.source) : undefined;
    if (sourceId) {
      await db.citation.create({
        data: { treeId, sourceId, eventId: event.id, confidence: 'MEDIUM' },
      });
    }
  }
  log(`${LIFE_EVENTS.length} événements de vie`);
}

async function seedConflictingClaims(
  db: Database,
  treeId: string,
  personIds: Ids,
  sourceIds: Ids,
): Promise<void> {
  for (const entry of CONFLICTING_CLAIMS) {
    const personId = personIds.get(entry.person);
    const sourceId = sourceIds.get(entry.source);
    if (!personId) continue;

    const date = parseGenealogicalDate(entry.date);

    const claim = await db.claim.create({
      data: {
        treeId,
        personId,
        predicate: entry.predicate,
        // The claim stores the date as text, so it round-trips through the
        // same parser the rest of the product uses rather than through a
        // second, divergent representation.
        value: { date: entry.date, earliestJdn: date.interval.earliest },
        valueText: entry.date,
        status: entry.status,
        confidence: entry.confidence,
        reviewNote: entry.note,
        ...(entry.status === 'ACCEPTED' ? { reviewedAt: new Date() } : {}),
      },
    });

    if (sourceId) {
      const citation = await db.citation.create({
        data: { treeId, sourceId, quotation: entry.note, confidence: entry.confidence },
      });
      await db.claimCitation.create({ data: { claimId: claim.id, citationId: citation.id } });
    }
  }
  log(`${CONFLICTING_CLAIMS.length} affirmations (dont contradictoires)`);
}

/**
 * The pending duplicate is found, not written by hand.
 *
 * The demo carries Augustin CHASSAGNE twice, once as a transcription
 * variant. Running the real scanner over the seeded tree means the
 * demonstration shows what the product actually produces — the same score,
 * the same signals, in the shape the review screen reads — instead of a row
 * invented here that no code path could produce.
 */
async function seedDuplicateCandidate(db: Database, treeId: string): Promise<void> {
  const result = await scanDuplicates(db, { treeId });
  log(
    `${result.recorded} doublon candidat sur ${result.examined} paires examinées ` +
      '(à examiner, jamais fusionné automatiquement)',
  );
}

async function seedResearchTasks(db: Database, treeId: string, personIds: Ids): Promise<void> {
  const tasks = [
    {
      person: 'henriette',
      title: "Retrouver l'acte de décès d'Henriette MOREAU",
      hypothesis: 'Décédée à Tours ou dans un département voisin après 1931 ?',
      repository: "Archives départementales d'Indre-et-Loire",
      searchFrom: '1931',
      searchTo: '1975',
      placeLabel: 'Tours et communes limitrophes',
      priority: 'HIGH' as const,
    },
    {
      person: 'hippolyte',
      title: "Vérifier la filiation d'Hippolyte CHASSAGNE",
      hypothesis:
        "Victoire aurait eu 58 ans à sa naissance. S'agit-il d'un petit-fils inscrit comme fils ?",
      repository: "Archives départementales d'Indre-et-Loire",
      searchFrom: '1856',
      searchTo: '1856',
      placeLabel: 'Tours',
      priority: 'URGENT' as const,
    },
    {
      person: 'mathurin',
      title: "Chercher l'acte de baptême de Mathurin CHASSAGNE",
      hypothesis: 'Baptisé à Azay-le-Rideau vers 1702 ?',
      repository: "Archives départementales d'Indre-et-Loire",
      searchFrom: '1698',
      searchTo: '1710',
      placeLabel: 'Azay-le-Rideau',
      priority: 'NORMAL' as const,
    },
  ];

  for (const task of tasks) {
    const personId = personIds.get(task.person);
    const from = parseGenealogicalDate(task.searchFrom);
    const to = parseGenealogicalDate(task.searchTo);

    await db.researchTask.create({
      data: {
        treeId,
        ...(personId ? { personId } : {}),
        title: task.title,
        hypothesis: task.hypothesis,
        status: 'TODO',
        priority: task.priority,
        repository: task.repository,
        placeLabel: task.placeLabel,
        ...(from.interval.earliest !== null ? { searchFromJdn: from.interval.earliest } : {}),
        ...(to.interval.latest !== null ? { searchToJdn: to.interval.latest } : {}),
      },
    });
  }
  log(`${tasks.length} pistes de recherche`);
}

async function seedHistoricalEvents(db: Database, treeId: string): Promise<void> {
  for (const entry of HISTORICAL_EVENTS) {
    const start = parseGenealogicalDate(entry.start);
    const end = parseGenealogicalDate(entry.end);
    if (start.interval.earliest === null || end.interval.latest === null) continue;

    // Historical events are shared across trees rather than copied into each:
    // the Second World War is not a property of anyone's family.
    const existing = await db.historicalEvent.findFirst({ where: { title: entry.title } });
    const historical =
      existing ??
      (await db.historicalEvent.create({
        data: {
          title: entry.title,
          summary: entry.summary,
          category: entry.category,
          significance: entry.significance,
          startJdn: start.interval.earliest,
          endJdn: end.interval.latest,
          countryCodes: [...entry.countryCodes],
          locale: 'fr',
        },
      }));

    await db.treeHistoricalEvent.upsert({
      where: {
        treeId_historicalEventId: { treeId, historicalEventId: historical.id },
      },
      update: {},
      create: { treeId, historicalEventId: historical.id, pinned: entry.significance >= 5 },
    });
  }
  log(`${HISTORICAL_EVENTS.length} repères historiques`);
}

/**
 * Rebuild the derived temporal cache on every person.
 *
 * Run last, after the events and claims it reads exist. Running it as a
 * separate pass rather than inline is what proves the cache is genuinely
 * rebuildable from the evidence — the property that keeps it from drifting
 * into a second, divergent source of truth.
 */
async function projectLifespans(db: Database, treeId: string): Promise<void> {
  const people = await db.person.findMany({
    where: { treeId },
    select: {
      id: true,
      livingStatus: true,
      eventRoles: {
        select: {
          event: {
            select: {
              type: true,
              dateQualifier: true,
              dateCalendar: true,
              datePrecision: true,
              dateStartYear: true,
              dateStartMonth: true,
              dateStartDay: true,
              dateEndYear: true,
              dateEndMonth: true,
              dateEndDay: true,
              dateOriginalText: true,
              dateUnparsed: true,
            },
          },
        },
      },
      claims: { select: { predicate: true, status: true, value: true } },
    },
  });

  for (const person of people) {
    const projection = projectPersonLifespan(
      {
        livingStatus: person.livingStatus,
        events: person.eventRoles.map((role) => role.event),
        claims: person.claims,
      },
      TODAY_JDN,
    );

    await db.person.update({
      where: { id: person.id },
      data: lifespanColumns(projection),
    });
  }

  log(`${people.length} durées de vie projetées`);
}

async function report(db: Database, treeId: string): Promise<void> {
  const [people, relationships, events, sources, citations, claims, places, tasks, duplicates] =
    await Promise.all([
      db.person.count({ where: { treeId } }),
      db.relationship.count({ where: { treeId } }),
      db.event.count({ where: { treeId } }),
      db.source.count({ where: { treeId } }),
      db.citation.count({ where: { treeId } }),
      db.claim.count({ where: { treeId } }),
      db.place.count({ where: { treeId } }),
      db.researchTask.count({ where: { treeId } }),
      db.duplicateCandidate.count({ where: { treeId } }),
    ]);

  const span = await db.person.aggregate({
    where: { treeId, lifespanEarliestJdn: { not: null } },
    _min: { lifespanEarliestJdn: true },
    _max: { lifespanLatestJdn: true },
  });

  const years =
    span._min.lifespanEarliestJdn && span._max.lifespanLatestJdn
      ? Math.round((span._max.lifespanLatestJdn - span._min.lifespanEarliestJdn) / 365.2425)
      : 0;

  log('');
  log('  ' + String(people).padStart(4) + ' personnes');
  log('  ' + String(relationships).padStart(4) + ' relations');
  log('  ' + String(events).padStart(4) + ' événements');
  log('  ' + String(places).padStart(4) + ' lieux');
  log('  ' + String(sources).padStart(4) + ' sources, ' + citations + ' citations');
  log('  ' + String(claims).padStart(4) + ' affirmations');
  log('  ' + String(tasks).padStart(4) + ' pistes de recherche');
  log('  ' + String(duplicates).padStart(4) + ' doublon(s) à examiner');
  log('  ' + String(years).padStart(4) + " ans d'histoire familiale");
  log('');
}

await main();
