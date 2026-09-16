import { toGedcomDateValue, type GenealogicalDate } from '@chronolignee/domain';
import type {
  ImportEvent,
  ImportName,
  ImportPerson,
  ImportPlan,
  ImportRelationship,
} from './mapper';

/**
 * GEDCOM 7 output.
 *
 * Writes the FamilySearch GEDCOM 7.0 structure, which means families are real
 * records again. Our model stores parentage as directed relationships between
 * people, because that is what lets a child have a biological and an adoptive
 * father without inventing a second family; GEDCOM stores it as FAM records
 * with HUSB, WIFE and CHIL. Reassembling families on the way out is the
 * awkward half of that trade, and it happens here rather than leaking into
 * the domain.
 *
 * Uncertainty survives the trip. A date exported as `ABT 1877` reads back as
 * ABOUT, and a date we never understood goes out as a GEDCOM date phrase — in
 * parentheses, exactly as the specification provides for — so a value we could
 * not parse is still not a value we destroyed.
 */

export interface WriteOptions {
  /** Appears in HEAD.SOUR, identifying what produced the file. */
  readonly generator?: string;
  readonly generatorVersion?: string;
  readonly submitterName?: string;
}

const GEDCOM_VERSION = '7.0';

export function writeGedcom(plan: ImportPlan, options: WriteOptions = {}): string {
  const lines: string[] = [];
  const write = (level: number, tag: string, value?: string, xref?: string): void => {
    const parts = [String(level)];
    if (xref) parts.push(xref);
    parts.push(tag);
    if (value !== undefined && value !== '') parts.push(value);
    lines.push(parts.join(' '));
  };

  /**
   * Multi-line values become CONT lines.
   *
   * GEDCOM 7 removed CONC, so a long single-line value simply stays long:
   * the old 255-character limit and the ambiguity about where a split
   * swallowed a space are both gone, and re-introducing them would be a
   * courtesy to nobody.
   */
  const writeText = (level: number, tag: string, value: string | undefined): void => {
    if (!value) return;
    const [first = '', ...rest] = value.split('\n');
    write(level, tag, first);
    for (const line of rest) write(level + 1, 'CONT', line);
  };

  const writeDate = (level: number, date: GenealogicalDate | null): void => {
    const value = toGedcomDateValue(date);
    if (value) write(level, 'DATE', value);
  };

  // --- Header --------------------------------------------------------------

  write(0, 'HEAD');
  write(1, 'GEDC');
  write(2, 'VERS', GEDCOM_VERSION);
  write(1, 'SOUR', options.generator ?? 'CHRONOLIGNEE');
  write(2, 'NAME', 'Chronolignée');
  if (options.generatorVersion) write(2, 'VERS', options.generatorVersion);
  if (options.submitterName) {
    write(1, 'SUBM', '@SUBM1@');
  }

  const families = assembleFamilies(plan.relationships, plan.events);
  const eventsByPerson = groupPersonEvents(plan.events);

  // --- Individuals ---------------------------------------------------------

  for (const person of plan.people) {
    write(0, 'INDI', undefined, person.xref);

    for (const name of person.names) {
      writeName(write, name);
    }

    if (person.recordedSex !== 'UNKNOWN') {
      write(1, 'SEX', sexLetter(person.recordedSex));
    }

    for (const event of eventsByPerson.get(person.xref) ?? []) {
      writeEvent(write, writeText, writeDate, event);
    }

    for (const family of families.spousalOf(person.xref)) write(1, 'FAMS', family);
    for (const family of families.childOf(person.xref)) write(1, 'FAMC', family);

    for (const note of person.notes) writeText(1, 'NOTE', note);
    for (const sourceXref of person.sourceXrefs) write(1, 'SOUR', sourceXref);
  }

  // --- Families ------------------------------------------------------------

  for (const family of families.all()) {
    write(0, 'FAM', undefined, family.xref);
    if (family.husband) write(1, 'HUSB', family.husband);
    if (family.wife) write(1, 'WIFE', family.wife);
    for (const child of family.children) write(1, 'CHIL', child);

    for (const event of family.events) {
      writeEvent(write, writeText, writeDate, event);
    }
  }

  // --- Sources -------------------------------------------------------------

  for (const source of plan.sources) {
    write(0, 'SOUR', undefined, source.xref);
    writeText(1, 'TITL', source.title);
    writeText(1, 'AUTH', source.author);
    writeText(1, 'PUBL', source.publication);
    if (source.repository) {
      write(1, 'REPO', source.repository);
      if (source.callNumber) write(2, 'CALN', source.callNumber);
    }
  }

  write(0, 'TRLR');

  // GEDCOM 7 mandates CRLF and a trailing terminator.
  return `${lines.join('\r\n')}\r\n`;
}

type WriteFn = (level: number, tag: string, value?: string, xref?: string) => void;
type WriteTextFn = (level: number, tag: string, value: string | undefined) => void;
type WriteDateFn = (level: number, date: GenealogicalDate | null) => void;

function writeName(write: WriteFn, name: ImportName): void {
  // The slash form is what every reader understands, so it is written even
  // though the structured sub-tags below are more precise.
  const composed = `${name.given ?? ''} /${name.surname ?? ''}/${name.suffix ? ` ${name.suffix}` : ''}`;
  write(1, 'NAME', composed.trim());

  if (name.type !== 'BIRTH') write(2, 'TYPE', name.type);
  if (name.prefix) write(2, 'NPFX', name.prefix);
  if (name.given) write(2, 'GIVN', name.given);
  if (name.nickname) write(2, 'NICK', name.nickname);
  if (name.surname) write(2, 'SURN', name.surname);
  if (name.suffix) write(2, 'NSFX', name.suffix);
}

function writeEvent(
  write: WriteFn,
  writeText: WriteTextFn,
  writeDate: WriteDateFn,
  event: ImportEvent,
): void {
  const tag = EVENT_TAGS[event.type] ?? 'EVEN';
  write(1, tag, tag === 'EVEN' ? undefined : event.description);

  if (tag === 'EVEN' && event.customType) write(2, 'TYPE', event.customType);
  writeDate(2, event.date);
  if (event.placeName) writeText(2, 'PLAC', event.placeName);
  for (const sourceXref of event.sourceXrefs) write(2, 'SOUR', sourceXref);
}

const EVENT_TAGS: Readonly<Record<string, string>> = {
  BIRTH: 'BIRT',
  BAPTISM: 'BAPM',
  DEATH: 'DEAT',
  BURIAL: 'BURI',
  CREMATION: 'CREM',
  MARRIAGE: 'MARR',
  MARRIAGE_BANN: 'MARB',
  MARRIAGE_CONTRACT: 'MARC',
  DIVORCE: 'DIV',
  RESIDENCE: 'RESI',
  OCCUPATION: 'OCCU',
  EDUCATION: 'EDUC',
  MIGRATION: 'EMIG',
  NATURALIZATION: 'NATU',
  CENSUS: 'CENS',
  PROBATE: 'PROB',
  WILL: 'WILL',
  RELIGIOUS_EVENT: 'RELI',
  CUSTOM: 'EVEN',
};

function sexLetter(sex: ImportPerson['recordedSex']): string {
  return sex === 'MALE' ? 'M' : sex === 'FEMALE' ? 'F' : sex === 'INTERSEX' ? 'X' : 'U';
}

interface AssembledFamily {
  readonly xref: string;
  husband: string | undefined;
  wife: string | undefined;
  readonly children: string[];
  readonly events: ImportEvent[];
}

/**
 * Rebuild FAM records from directed relationships.
 *
 * A family is keyed by its set of parents, so two children of the same couple
 * land in one record rather than two. A single parent still gets a family —
 * GEDCOM has no other way to express a child with one recorded parent, and
 * dropping the link to avoid an odd-looking record would lose the parentage.
 */
function assembleFamilies(
  relationships: readonly ImportRelationship[],
  events: readonly ImportEvent[],
) {
  const byParentSet = new Map<string, AssembledFamily>();
  const parentsOfChild = new Map<string, Set<string>>();
  const partnerships: ImportRelationship[] = [];

  for (const relationship of relationships) {
    if (relationship.type.startsWith('PARENT_')) {
      const set = parentsOfChild.get(relationship.targetXref) ?? new Set<string>();
      set.add(relationship.sourceXref);
      parentsOfChild.set(relationship.targetXref, set);
      continue;
    }
    partnerships.push(relationship);
  }

  let counter = 0;
  const ensure = (parents: readonly string[]): AssembledFamily => {
    const key = [...parents].sort().join('|');
    const existing = byParentSet.get(key);
    if (existing) return existing;

    counter += 1;
    const family: AssembledFamily = {
      xref: `@F${counter}@`,
      husband: parents[0],
      wife: parents[1],
      children: [],
      events: [],
    };
    byParentSet.set(key, family);
    return family;
  };

  // Couples are created first, so a married couple's family exists before
  // their children look for it and cannot end up split across two records.
  for (const relationship of partnerships) {
    ensure([relationship.sourceXref, relationship.targetXref]);
  }

  for (const [child, parents] of parentsOfChild) {
    ensure([...parents]).children.push(child);
  }

  // Marriages and divorces belong on the FAM record. Matching them by the set
  // of spouses rather than by order means a MARR whose HUSB and WIFE were
  // recorded the other way round still lands on the right family instead of
  // creating a second, childless one.
  for (const event of events) {
    if (event.type !== 'MARRIAGE' && event.type !== 'DIVORCE') continue;
    const spouses = event.participants.map((p) => p.xref);
    if (spouses.length === 0) continue;
    ensure(spouses).events.push(event);
  }

  return {
    all: (): AssembledFamily[] => [...byParentSet.values()],
    spousalOf: (xref: string): string[] =>
      [...byParentSet.values()]
        .filter((family) => family.husband === xref || family.wife === xref)
        .map((family) => family.xref),
    childOf: (xref: string): string[] =>
      [...byParentSet.values()]
        .filter((family) => family.children.includes(xref))
        .map((family) => family.xref),
  };
}

function groupPersonEvents(events: readonly ImportEvent[]): Map<string, ImportEvent[]> {
  const grouped = new Map<string, ImportEvent[]>();

  for (const event of events) {
    // Family events are written on the FAM record, not on each spouse.
    if (event.type === 'MARRIAGE' || event.type === 'DIVORCE') continue;
    for (const participant of event.participants) {
      const list = grouped.get(participant.xref) ?? [];
      list.push(event);
      grouped.set(participant.xref, list);
    }
  }
  return grouped;
}
