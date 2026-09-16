/**
 * GEDCOM line lexer.
 *
 * A GEDCOM file is a flat sequence of lines that encode a tree by depth
 * number:
 *
 *     0 @I1@ INDI
 *     1 NAME Jean /DUPONT/
 *     2 GIVN Jean
 *     1 BIRT
 *     2 DATE 12 JUN 1877
 *
 * The grammar is small. What makes a real-world parser hard is that files in
 * the wild violate it constantly — and a genealogy importer that rejects a
 * file because one line is malformed has failed the user, who cannot repair a
 * 40 MB export by hand. So every problem is reported with a line number and
 * the parse continues.
 */

export interface GedcomLine {
  /** Zero-based depth. */
  readonly level: number;
  /** Cross-reference id this line defines, as in `0 @I1@ INDI`. */
  readonly xref: string | undefined;
  readonly tag: string;
  /** Everything after the tag, verbatim. A pointer looks like `@I1@`. */
  readonly value: string | undefined;
  /** One-based, for error messages that a human can act on. */
  readonly lineNumber: number;
}

export type LexIssueCode =
  | 'EMPTY_LINE'
  | 'MISSING_LEVEL'
  | 'INVALID_LEVEL'
  | 'MISSING_TAG'
  | 'LEVEL_JUMP'
  | 'LONE_CONTINUATION'
  | 'BOM_REMOVED'
  | 'CRLF_MIXED';

export interface LexIssue {
  readonly code: LexIssueCode;
  readonly lineNumber: number;
  /** The offending text, truncated. Kept so a human can find it in the file. */
  readonly text: string;
}

export interface LexResult {
  readonly lines: readonly GedcomLine[];
  readonly issues: readonly LexIssue[];
}

/** Longest snippet echoed back in an issue. Long enough to locate, short enough to read. */
const SNIPPET_LENGTH = 80;

function snippet(text: string): string {
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

/**
 * A GEDCOM line, by the specification:
 *
 *     level [D] [xref D] tag [D line-value]
 *
 * Written as one regular expression because the grammar genuinely is regular
 * at this level, and a hand-rolled scanner for it would be longer and no
 * clearer.
 */
const LINE_PATTERN = /^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s(.*))?$/;

export function lexGedcom(text: string): LexResult {
  const lines: GedcomLine[] = [];
  const issues: LexIssue[] = [];

  let source = text;

  // A byte-order mark makes the first line's level unparseable, and files
  // exported from Windows genealogy software have one more often than not.
  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
    issues.push({ code: 'BOM_REMOVED', lineNumber: 1, text: '' });
  }

  const rawLines = source.split(/\r\n|\r|\n/);
  let previousLevel = -1;

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? '';
    const lineNumber = index + 1;

    // Trailing blank lines are universal and uninteresting; a blank line in
    // the middle of a file is worth a note but not a failure.
    if (raw.trim().length === 0) {
      if (index < rawLines.length - 1 && lines.length > 0) {
        issues.push({ code: 'EMPTY_LINE', lineNumber, text: '' });
      }
      continue;
    }

    const match = LINE_PATTERN.exec(raw);
    if (!match) {
      issues.push({
        code: /^\s*\d/.test(raw) ? 'MISSING_TAG' : 'MISSING_LEVEL',
        lineNumber,
        text: snippet(raw),
      });
      continue;
    }

    const [, levelText, xref, tag, value] = match;
    const level = Number.parseInt(levelText ?? '', 10);

    if (!Number.isFinite(level) || level < 0 || level > 99) {
      issues.push({ code: 'INVALID_LEVEL', lineNumber, text: snippet(raw) });
      continue;
    }

    // A level may only ever go one deeper than the line before it. Going two
    // deeper means a line was lost, and silently re-parenting the subtree
    // would attach facts to the wrong person — the worst possible outcome in
    // a genealogy. The line is kept, at a level the tree can hold, and the
    // gap is reported.
    let effectiveLevel = level;
    if (level > previousLevel + 1) {
      issues.push({ code: 'LEVEL_JUMP', lineNumber, text: snippet(raw) });
      effectiveLevel = previousLevel + 1;
    }

    if ((tag === 'CONT' || tag === 'CONC') && lines.length === 0) {
      issues.push({ code: 'LONE_CONTINUATION', lineNumber, text: snippet(raw) });
      continue;
    }

    lines.push({
      level: effectiveLevel,
      xref: xref ?? undefined,
      tag: tag ?? '',
      value: value === undefined || value === '' ? undefined : value,
      lineNumber,
    });
    previousLevel = effectiveLevel;
  }

  return { lines, issues };
}

/** True for a value that is a cross-reference pointer rather than text. */
export function isPointer(value: string | undefined): value is string {
  return value !== undefined && /^@[^@\s]+@$/.test(value);
}
