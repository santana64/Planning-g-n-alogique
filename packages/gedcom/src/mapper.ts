import { parseGenealogicalDate, type GenealogicalDate } from '@chronolignee/domain';
import type { RelationshipType } from '@chronolignee/genealogy';
import { findChild, findChildren, type GedcomDocument, type GedcomNode } from './parser';

/**
 * GEDCOM records into domain structures.
 *
 * The output is a plan, not a write. Nothing touches the database until a
 * human has seen the counts and the warnings and said yes — an import that
 * silently rewrites a tree is the single most destructive thing a genealogy
 * application can do, because the damage is discovered months later.
 *
 * The governing rule throughout: never discard. A tag we do not understand, a
 * date we cannot parse, a pointer that goes nowhere — each is recorded and
 * carried forward. A researcher can repair a flagged oddity; they cannot
 * repair something the importer threw away without telling them.
 */

export interface ImportName {
  readonly given: string | undefined;
  readonly surname: string | undefined;
  readonly prefix: string | undefined;
  readonly suffix: string | undefined;
  readonly nickname: string | undefined;
  readonly type: 'BIRTH' | 'MARRIED' | 'AKA' | 'OTHER';
  readonly isPreferred: boolean;
  /** The NAME line as written, kept because our split can be wrong. */
  readonly original: string;
}

export interface ImportEvent {
  readonly type: string;
  readonly customType: string | undefined;
  readonly date: GenealogicalDate | null;
  readonly placeName: string | undefined;
  readonly description: string | undefined;
  /** Xrefs of the people taking part, with their role. */
  readonly participants: ReadonlyArray<{ xref: string; role: string }>;
  readonly sourceXrefs: readonly string[];
}

export interface ImportPerson {
  readonly xref: string;
  readonly names: readonly ImportName[];
  readonly recordedSex: 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN';
  readonly notes: readonly string[];
  readonly sourceXrefs: readonly string[];
  /** Tags on this record the mapper did not interpret. */
  readonly unhandledTags: readonly string[];
}

export interface ImportRelationship {
  readonly sourceXref: string;
  readonly targetXref: string;
  readonly type: RelationshipType;
  readonly startJdn: number | null;
  readonly endJdn: number | null;
}

export interface ImportSource {
  readonly xref: string;
  readonly title: string;
  readonly author: string | undefined;
  readonly publication: string | undefined;
  readonly repository: string | undefined;
  readonly callNumber: string | undefined;
}

export interface ImportPlace {
  readonly name: string;
  readonly latitude: number | undefined;
  readonly longitude: number | undefined;
}

export type ImportWarningCode =
  | 'UNPARSEABLE_DATE'
  | 'DANGLING_POINTER'
  | 'PERSON_WITHOUT_NAME'
  | 'FAMILY_WITHOUT_MEMBERS'
  | 'CHILD_IS_OWN_PARENT'
  | 'SELF_UNION'
  | 'UNION_DATES_REVERSED'
  | 'DUPLICATE_RELATIONSHIP'
  | 'UNHANDLED_RECORD'
  | 'AMBIGUOUS_NAME';

export interface ImportWarning {
  readonly code: ImportWarningCode;
  readonly lineNumber: number;
  readonly detail: string;
}

export interface ImportPlan {
  readonly people: readonly ImportPerson[];
  readonly relationships: readonly ImportRelationship[];
  readonly events: readonly ImportEvent[];
  readonly sources: readonly ImportSource[];
  readonly places: readonly ImportPlace[];
  readonly warnings: readonly ImportWarning[];
  readonly unknownTags: readonly string[];
  readonly counts: {
    readonly people: number;
    readonly families: number;
    readonly events: number;
    readonly sources: number;
    readonly places: number;
    readonly media: number;
    readonly relationships: number;
    readonly unparseableDates: number;
  };
}

/** GEDCOM event tags this importer understands, mapped to domain event types. */
const EVENT_TYPES: Readonly<Record<string, string>> = {
  BIRT: 'BIRTH',
  CHR: 'BAPTISM',
  BAPM: 'BAPTISM',
  DEAT: 'DEATH',
  BURI: 'BURIAL',
  CREM: 'CREMATION',
  MARR: 'MARRIAGE',
  MARB: 'MARRIAGE_BANN',
  MARC: 'MARRIAGE_CONTRACT',
  DIV: 'DIVORCE',
  RESI: 'RESIDENCE',
  OCCU: 'OCCUPATION',
  EDUC: 'EDUCATION',
  GRAD: 'EDUCATION',
  EMIG: 'MIGRATION',
  IMMI: 'MIGRATION',
  NATU: 'NATURALIZATION',
  CENS: 'CENSUS',
  PROB: 'PROBATE',
  WILL: 'WILL',
  RELI: 'RELIGIOUS_EVENT',
  CONF: 'RELIGIOUS_EVENT',
  ORDN: 'RELIGIOUS_EVENT',
  EVEN: 'CUSTOM',
};

/**
 * FAMC.PEDI, the pedigree linkage type.
 *
 * Absent means birth, which is the specification's default and also the
 * overwhelming majority of links. Mapping an unknown value to
 * PARENT_BIOLOGICAL would be a quiet falsification, so it becomes
 * PARENT_UNKNOWN instead — "there is a parental link and we do not know what
 * kind" is a statement the model can hold.
 */
const PEDIGREE_TYPES: Readonly<Record<string, RelationshipType>> = {
  BIRTH: 'PARENT_BIOLOGICAL',
  ADOPTED: 'PARENT_ADOPTIVE',
  FOSTER: 'PARENT_FOSTER',
  STEP: 'PARENT_STEP',
  SEALING: 'PARENT_ADOPTIVE',
};

const SEX_VALUES: Readonly<Record<string, ImportPerson['recordedSex']>> = {
  M: 'MALE',
  F: 'FEMALE',
  X: 'INTERSEX',
  U: 'UNKNOWN',
};

/** Tags the mapper reads. Anything else is reported, not dropped. */
export const KNOWN_TAGS: ReadonlySet<string> = new Set([
  'HEAD',
  'TRLR',
  'GEDC',
  'VERS',
  'CHAR',
  'SOUR',
  'DEST',
  'DATE',
  'TIME',
  'SUBM',
  'FORM',
  'NAME',
  'CORP',
  'LANG',
  'COPR',
  'NOTE',
  'INDI',
  'FAM',
  'OBJE',
  'REPO',
  'SNOTE',
  'GIVN',
  'SURN',
  'NPFX',
  'NSFX',
  'NICK',
  'SPFX',
  'TYPE',
  'SEX',
  'FAMC',
  'FAMS',
  'HUSB',
  'WIFE',
  'CHIL',
  'PEDI',
  'PLAC',
  'MAP',
  'LATI',
  'LONG',
  'TITL',
  'AUTH',
  'PUBL',
  'ABBR',
  'PAGE',
  'QUAY',
  'CALN',
  'FILE',
  'TEXT',
  ...Object.keys(EVENT_TYPES),
]);

export function mapDocument(document: GedcomDocument): ImportPlan {
  const warnings: ImportWarning[] = [];
  const people: ImportPerson[] = [];
  const relationships: ImportRelationship[] = [];
  const events: ImportEvent[] = [];
  const sources: ImportSource[] = [];
  const placeNames = new Map<string, ImportPlace>();

  let unparseableDates = 0;
  let mediaCount = 0;
  let familyCount = 0;

  const knownXrefs = new Set(
    document.records.filter((r) => r.xref !== undefined).map((r) => r.xref as string),
  );

  const recordDate = (node: GedcomNode | undefined): GenealogicalDate | null => {
    const raw = findChild(node, 'DATE')?.value;
    if (!raw) return null;
    const parsed = parseGenealogicalDate(raw);
    if (parsed.unparsed) {
      unparseableDates += 1;
      warnings.push({
        code: 'UNPARSEABLE_DATE',
        lineNumber: findChild(node, 'DATE')?.lineNumber ?? node?.lineNumber ?? 0,
        // The original is kept in the date object too; repeating it here means
        // the review screen can show it without re-walking the tree.
        detail: raw,
      });
    }
    return parsed;
  };

  const recordPlace = (node: GedcomNode | undefined): string | undefined => {
    const place = findChild(node, 'PLAC');
    const name = place?.value?.trim();
    if (!name) return undefined;

    if (!placeNames.has(name)) {
      const map = findChild(place, 'MAP');
      placeNames.set(name, {
        name,
        latitude: parseCoordinate(findChild(map, 'LATI')?.value),
        longitude: parseCoordinate(findChild(map, 'LONG')?.value),
      });
    }
    return name;
  };

  // --- Individuals ---------------------------------------------------------

  for (const record of document.records) {
    if (record.tag !== 'INDI' || !record.xref) continue;

    const names = findChildren(record, 'NAME').map((node, index) => mapName(node, index === 0));
    if (names.length === 0) {
      warnings.push({
        code: 'PERSON_WITHOUT_NAME',
        lineNumber: record.lineNumber,
        detail: record.xref,
      });
    }

    const unhandled = record.children
      .map((child) => child.tag)
      .filter((tag) => !KNOWN_TAGS.has(tag));

    people.push({
      xref: record.xref,
      names,
      recordedSex:
        SEX_VALUES[findChild(record, 'SEX')?.value?.trim().toUpperCase() ?? ''] ?? 'UNKNOWN',
      notes: findChildren(record, 'NOTE')
        .map((n) => n.value ?? '')
        .filter(Boolean),
      sourceXrefs: pointerValues(record, 'SOUR', knownXrefs, warnings),
      unhandledTags: [...new Set(unhandled)],
    });

    for (const child of record.children) {
      const eventType = EVENT_TYPES[child.tag];
      if (!eventType) continue;
      // Family events (MARR, DIV) belong to the FAM record and are read
      // there; reading them here too would duplicate every marriage.
      if (child.tag === 'MARR' || child.tag === 'DIV') continue;

      events.push({
        type: eventType,
        customType:
          child.tag === 'EVEN' ? (findChild(child, 'TYPE')?.value ?? 'Événement') : undefined,
        date: recordDate(child),
        placeName: recordPlace(child),
        description: child.value?.trim() || findChild(child, 'TYPE')?.value || undefined,
        participants: [{ xref: record.xref, role: 'PRINCIPAL' }],
        sourceXrefs: pointerValues(child, 'SOUR', knownXrefs, warnings),
      });
    }
  }

  // --- Families ------------------------------------------------------------

  for (const record of document.records) {
    if (record.tag !== 'FAM') continue;
    familyCount += 1;

    const husbands = pointerValues(record, 'HUSB', knownXrefs, warnings);
    const wives = pointerValues(record, 'WIFE', knownXrefs, warnings);
    const children = pointerValues(record, 'CHIL', knownXrefs, warnings);
    const spouses = [...husbands, ...wives];

    if (spouses.length === 0 && children.length === 0) {
      warnings.push({
        code: 'FAMILY_WITHOUT_MEMBERS',
        lineNumber: record.lineNumber,
        detail: record.xref ?? '(sans identifiant)',
      });
      continue;
    }

    const marriage = findChild(record, 'MARR');
    const divorce = findChild(record, 'DIV');
    const marriageDate = marriage ? recordDate(marriage) : null;
    const divorceDate = divorce ? recordDate(divorce) : null;

    // Sources cited on the FAM record itself rather than on the event inside
    // it. Both placements are legal and exporters disagree about which to
    // use, so reading only one silently drops a citation — the opposite of
    // what this importer is for.
    const familySources = pointerValues(record, 'SOUR', knownXrefs, warnings);

    if (spouses.length === 2 && spouses[0] && spouses[1]) {
      if (spouses[0] === spouses[1]) {
        warnings.push({ code: 'SELF_UNION', lineNumber: record.lineNumber, detail: spouses[0] });
      } else {
        const startJdn = marriageDate?.interval.earliest ?? null;
        const endJdn = divorceDate?.interval.latest ?? null;
        // A divorce dated before the marriage is a typing error in one of the
        // two dates, and nothing in the file says which. The union is kept
        // and both events are imported as written; only the window, which
        // would contradict itself, is left out — and the review says so.
        const reversed = startJdn !== null && endJdn !== null && startJdn > endJdn;
        if (reversed) {
          warnings.push({
            code: 'UNION_DATES_REVERSED',
            lineNumber: record.lineNumber,
            detail: record.xref ?? '(sans identifiant)',
          });
        }
        relationships.push({
          sourceXref: spouses[0],
          targetXref: spouses[1],
          type: divorce ? 'DIVORCED_PARTNER' : marriage ? 'SPOUSE' : 'PARTNER',
          startJdn: reversed ? null : startJdn,
          endJdn: reversed ? null : endJdn,
        });
      }
    }

    for (const node of [marriage, divorce]) {
      if (!node) continue;
      events.push({
        type: node === marriage ? 'MARRIAGE' : 'DIVORCE',
        customType: undefined,
        date: node === marriage ? marriageDate : divorceDate,
        placeName: recordPlace(node),
        description: undefined,
        participants: spouses.map((xref) => ({ xref, role: 'SPOUSE' })),
        sourceXrefs: [
          ...new Set([...pointerValues(node, 'SOUR', knownXrefs, warnings), ...familySources]),
        ],
      });
    }

    for (const childXref of children) {
      for (const parentXref of spouses) {
        if (parentXref === childXref) {
          warnings.push({
            code: 'CHILD_IS_OWN_PARENT',
            lineNumber: record.lineNumber,
            detail: childXref,
          });
          continue;
        }
        relationships.push({
          sourceXref: parentXref,
          targetXref: childXref,
          type: pedigreeFor(document, childXref, record.xref),
          startJdn: null,
          endJdn: null,
        });
      }
    }
  }

  // --- Sources and media ---------------------------------------------------

  for (const record of document.records) {
    if (record.tag === 'OBJE') {
      mediaCount += 1;
      continue;
    }
    if (record.tag !== 'SOUR' || !record.xref) continue;

    sources.push({
      xref: record.xref,
      title: findChild(record, 'TITL')?.value?.trim() || record.xref,
      author: findChild(record, 'AUTH')?.value?.trim(),
      publication: findChild(record, 'PUBL')?.value?.trim(),
      repository: findChild(record, 'REPO')?.value?.trim(),
      callNumber: findChild(findChild(record, 'REPO'), 'CALN')?.value?.trim(),
    });
  }

  const deduped = dedupeRelationships(relationships, warnings);

  return {
    people,
    relationships: deduped,
    events,
    sources,
    places: [...placeNames.values()],
    warnings,
    unknownTags: [...new Set(document.records.flatMap(collectTags))]
      .filter((tag) => !KNOWN_TAGS.has(tag))
      .sort(),
    counts: {
      people: people.length,
      families: familyCount,
      events: events.length,
      sources: sources.length,
      places: placeNames.size,
      media: mediaCount,
      relationships: deduped.length,
      unparseableDates,
    },
  };
}

function collectTags(node: GedcomNode): string[] {
  return [node.tag, ...node.children.flatMap(collectTags)];
}

/**
 * Split a GEDCOM NAME value: `Jean /DUPONT/ Jr`.
 *
 * The slashes delimit the surname. Structured GIVN/SURN sub-tags win when
 * present, because the slash convention breaks on compound surnames and every
 * exporter handles it slightly differently. The original line is kept
 * regardless — our split is a guess, and a guess that discards its input
 * cannot be corrected.
 */
function mapName(node: GedcomNode, isFirst: boolean): ImportName {
  const original = node.value ?? '';
  const match = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(original);

  const fromSlashes = match
    ? {
        given: match[1]?.trim() || undefined,
        surname: match[2]?.trim() || undefined,
        suffix: match[3]?.trim() || undefined,
      }
    : { given: original.trim() || undefined, surname: undefined, suffix: undefined };

  const declaredType = findChild(node, 'TYPE')?.value?.toUpperCase();

  return {
    given: findChild(node, 'GIVN')?.value?.trim() || fromSlashes.given,
    surname: findChild(node, 'SURN')?.value?.trim() || fromSlashes.surname,
    prefix: findChild(node, 'NPFX')?.value?.trim(),
    suffix: findChild(node, 'NSFX')?.value?.trim() || fromSlashes.suffix,
    nickname: findChild(node, 'NICK')?.value?.trim(),
    type:
      declaredType === 'MARRIED'
        ? 'MARRIED'
        : declaredType === 'AKA'
          ? 'AKA'
          : declaredType
            ? 'OTHER'
            : 'BIRTH',
    isPreferred: isFirst,
    original,
  };
}

/** Pointer children of a tag, with dangling references reported. */
function pointerValues(
  node: GedcomNode,
  tag: string,
  known: ReadonlySet<string>,
  warnings: ImportWarning[],
): string[] {
  const values: string[] = [];

  for (const child of findChildren(node, tag)) {
    const value = child.value?.trim();
    if (!value || !/^@[^@\s]+@$/.test(value)) continue;

    if (!known.has(value)) {
      // A pointer to a record that is not in the file. Common in partial
      // exports, and reported rather than silently creating a phantom person.
      warnings.push({
        code: 'DANGLING_POINTER',
        lineNumber: child.lineNumber,
        detail: `${tag} → ${value}`,
      });
      continue;
    }
    values.push(value);
  }
  return values;
}

/** The pedigree type this child declares for this family, defaulting to birth. */
function pedigreeFor(
  document: GedcomDocument,
  childXref: string,
  familyXref: string | undefined,
): RelationshipType {
  const child = document.byXref.get(childXref);
  if (!child || !familyXref) return 'PARENT_BIOLOGICAL';

  const link = findChildren(child, 'FAMC').find((node) => node.value?.trim() === familyXref);
  const pedi = findChild(link, 'PEDI');
  const pedigree = pedi?.value?.trim().toUpperCase();
  if (!pedigree) return 'PARENT_BIOLOGICAL';
  if (pedigree === 'OTHER') {
    // GEDCOM 7 has no step or guardian value: OTHER, and a phrase saying which.
    const phrase = findChild(pedi, 'PHRASE')?.value?.toLowerCase() ?? '';
    if (/step|beau|belle/.test(phrase)) return 'PARENT_STEP';
    if (/guardian|tut(eur|rice)/.test(phrase)) return 'PARENT_GUARDIAN';
    return 'PARENT_UNKNOWN';
  }

  return PEDIGREE_TYPES[pedigree] ?? 'PARENT_UNKNOWN';
}

/**
 * Collapse repeated relationships.
 *
 * Files routinely state the same parentage twice — once in the FAM record and
 * once through the child's FAMC — and the database refuses a duplicate. One
 * link is what the file means; two would be a failed import.
 */
function dedupeRelationships(
  relationships: readonly ImportRelationship[],
  warnings: ImportWarning[],
): ImportRelationship[] {
  const seen = new Map<string, ImportRelationship>();

  for (const relationship of relationships) {
    const key = `${relationship.sourceXref}|${relationship.targetXref}|${relationship.type}`;
    if (seen.has(key)) {
      warnings.push({
        code: 'DUPLICATE_RELATIONSHIP',
        lineNumber: 0,
        detail: key,
      });
      continue;
    }
    seen.set(key, relationship);
  }
  return [...seen.values()];
}

/** GEDCOM coordinates look like `N47.3941` or `W0.6848`. */
function parseCoordinate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^([NSEW])?\s*(-?\d+(?:\.\d+)?)$/i.exec(value.trim());
  if (!match) return undefined;

  const magnitude = Number.parseFloat(match[2] ?? '');
  if (!Number.isFinite(magnitude)) return undefined;

  const hemisphere = match[1]?.toUpperCase();
  return hemisphere === 'S' || hemisphere === 'W' ? -magnitude : magnitude;
}
