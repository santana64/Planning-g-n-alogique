import { lexGedcom, type GedcomLine, type LexIssue } from './lexer';

/**
 * Builds the record tree from the flat line sequence.
 *
 * Two things this does that a naive parser does not:
 *
 *  - CONT and CONC are folded into the parent's value rather than surviving as
 *    nodes. They are a transport detail of a line-oriented format, not
 *    genealogical structure, and leaving them in the tree pushes that detail
 *    into every consumer.
 *  - Unrecognised tags are kept. An importer that drops what it does not
 *    understand turns a round trip into data loss, and a family's notes are
 *    exactly the kind of thing a non-standard tag holds.
 */

export interface GedcomNode {
  readonly tag: string;
  /** The id this record defines, for level-0 records. */
  readonly xref: string | undefined;
  readonly value: string | undefined;
  readonly children: GedcomNode[];
  readonly lineNumber: number;
}

export type ParseIssueCode =
  | 'ORPHAN_LINE'
  | 'DUPLICATE_XREF'
  | 'UNKNOWN_VERSION'
  | 'CONC_IN_GEDCOM7'
  | 'NO_HEADER'
  | 'NO_RECORDS';

export interface ParseIssue {
  readonly code: ParseIssueCode;
  readonly lineNumber: number;
  readonly text: string;
}

export interface GedcomDocument {
  readonly header: GedcomNode | null;
  readonly records: readonly GedcomNode[];
  readonly byXref: ReadonlyMap<string, GedcomNode>;
  /** As declared in HEAD.GEDC.VERS, verbatim. */
  readonly version: string | null;
  readonly generator: string | null;
  readonly declaredEncoding: string | null;
  readonly lexIssues: readonly LexIssue[];
  readonly parseIssues: readonly ParseIssue[];
}

interface MutableNode {
  tag: string;
  xref: string | undefined;
  value: string | undefined;
  children: MutableNode[];
  lineNumber: number;
}

function toNode(node: MutableNode): GedcomNode {
  return {
    tag: node.tag,
    xref: node.xref,
    value: node.value,
    children: node.children.map(toNode),
    lineNumber: node.lineNumber,
  };
}

export function parseGedcom(text: string): GedcomDocument {
  const { lines, issues: lexIssues } = lexGedcom(text);
  const parseIssues: ParseIssue[] = [];

  const roots: MutableNode[] = [];
  const byXref = new Map<string, GedcomNode>();
  // Index by depth, so a line at level n attaches to stack[n - 1].
  const stack: MutableNode[] = [];

  for (const line of lines) {
    if (foldContinuation(line, stack, parseIssues)) continue;

    const node: MutableNode = {
      tag: line.tag,
      xref: line.xref,
      value: line.value,
      children: [],
      lineNumber: line.lineNumber,
    };

    if (line.level === 0) {
      roots.push(node);
      stack.length = 0;
      stack[0] = node;
      continue;
    }

    const parent = stack[line.level - 1];
    if (!parent) {
      // The lexer already clamps level jumps, so this means the file opened
      // at a level above zero. Nothing can hold the line, so it is reported
      // rather than silently attached to whatever came last.
      parseIssues.push({
        code: 'ORPHAN_LINE',
        lineNumber: line.lineNumber,
        text: `${line.level} ${line.tag}`,
      });
      continue;
    }

    parent.children.push(node);
    stack.length = line.level;
    stack[line.level] = node;
  }

  const records = roots.map(toNode);
  for (const record of records) {
    if (!record.xref) continue;
    if (byXref.has(record.xref)) {
      // Two records claiming the same id. Keeping the first is arbitrary but
      // stable, and merging them would invent a person who never existed.
      parseIssues.push({
        code: 'DUPLICATE_XREF',
        lineNumber: record.lineNumber,
        text: record.xref,
      });
      continue;
    }
    byXref.set(record.xref, record);
  }

  const header = records.find((record) => record.tag === 'HEAD') ?? null;
  const version = findValue(header, ['GEDC', 'VERS']);
  const declaredEncoding = findValue(header, ['CHAR']);
  const generator = findValue(header, ['SOUR']);

  if (!header) {
    parseIssues.push({ code: 'NO_HEADER', lineNumber: 1, text: '' });
  }
  if (records.filter((r) => r.tag !== 'HEAD' && r.tag !== 'TRLR').length === 0) {
    parseIssues.push({ code: 'NO_RECORDS', lineNumber: 1, text: '' });
  }
  if (version && !/^[57]\./.test(version)) {
    parseIssues.push({
      code: 'UNKNOWN_VERSION',
      lineNumber: header?.lineNumber ?? 1,
      text: version,
    });
  }

  return {
    header,
    records,
    byXref,
    version,
    generator,
    declaredEncoding,
    lexIssues,
    parseIssues,
  };
}

/**
 * Fold a CONT or CONC line into the value of the node above it.
 *
 * CONT adds a line break; CONC joins without one. GEDCOM 7 removed CONC
 * because implementations disagreed about whether a trailing space belonged
 * to the first half or the second, and got it wrong in both directions — so a
 * CONC in a file declaring 7.x is noted, then honoured anyway, because the
 * user's data matters more than the file's self-description.
 */
function foldContinuation(line: GedcomLine, stack: MutableNode[], issues: ParseIssue[]): boolean {
  if (line.tag !== 'CONT' && line.tag !== 'CONC') return false;

  const target = stack[line.level - 1];
  if (!target) {
    issues.push({ code: 'ORPHAN_LINE', lineNumber: line.lineNumber, text: line.tag });
    return true;
  }

  const addition = line.value ?? '';
  const existing = target.value ?? '';
  target.value = line.tag === 'CONT' ? `${existing}\n${addition}` : existing + addition;
  return true;
}

/** Walk a tag path from a node, returning the value at the end. */
export function findValue(
  node: GedcomNode | null | undefined,
  path: readonly string[],
): string | null {
  let current: GedcomNode | undefined = node ?? undefined;
  for (const tag of path) {
    current = current?.children.find((child) => child.tag === tag);
    if (!current) return null;
  }
  // An empty path leaves `current` as the node itself, which may be null.
  return current?.value ?? null;
}

export function findChild(node: GedcomNode | undefined, tag: string): GedcomNode | undefined {
  return node?.children.find((child) => child.tag === tag);
}

export function findChildren(node: GedcomNode | undefined, tag: string): GedcomNode[] {
  return node?.children.filter((child) => child.tag === tag) ?? [];
}

/** Tags this importer does not interpret, kept so export can put them back. */
export function collectUnknownTags(document: GedcomDocument, known: ReadonlySet<string>): string[] {
  const unknown = new Set<string>();

  const walk = (node: GedcomNode): void => {
    if (!known.has(node.tag)) unknown.add(node.tag);
    for (const child of node.children) walk(child);
  };

  for (const record of document.records) walk(record);
  return [...unknown].sort();
}
