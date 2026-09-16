import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatGenealogicalDate } from '@chronolignee/domain';
import { lexGedcom } from './lexer';
import { parseGedcom } from './parser';
import { mapDocument } from './mapper';
import { writeGedcom } from './writer';

/** A small but complete GEDCOM 7 file, using CRLF as the specification requires. */
const SAMPLE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '1 SOUR TESTSUITE',
  '0 @I1@ INDI',
  '1 NAME Jean /DUPONT/',
  '2 GIVN Jean',
  '2 SURN DUPONT',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 12 JUN 1877',
  '2 PLAC Tours, Indre-et-Loire, France',
  '3 MAP',
  '4 LATI N47.3941',
  '4 LONG E0.6848',
  '1 DEAT',
  '2 DATE ABT 1945',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Marie /MARTIN/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE 3 MAR 1880',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Pierre /DUPONT/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 1905',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 MARR',
  '2 DATE 8 SEP 1902',
  '2 PLAC Tours',
  '0 TRLR',
].join('\r\n');

describe('lexer', () => {
  it('reads level, xref, tag and value', () => {
    const { lines } = lexGedcom('0 @I1@ INDI\r\n1 NAME Jean /DUPONT/\r\n');
    expect(lines[0]).toMatchObject({ level: 0, xref: '@I1@', tag: 'INDI', value: undefined });
    expect(lines[1]).toMatchObject({ level: 1, tag: 'NAME', value: 'Jean /DUPONT/' });
  });

  it('strips a byte-order mark and says so', () => {
    const { lines, issues } = lexGedcom('﻿0 HEAD\r\n');
    expect(lines[0]?.tag).toBe('HEAD');
    expect(issues.map((i) => i.code)).toContain('BOM_REMOVED');
  });

  it('accepts CR, LF and CRLF alike', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      expect(lexGedcom(`0 HEAD${eol}0 TRLR${eol}`).lines).toHaveLength(2);
    }
  });

  it('clamps a level jump instead of re-parenting the subtree', () => {
    // Going two levels deeper means a line was lost. Attaching the orphan
    // where it happens to land would hang facts on the wrong person, which is
    // the worst outcome available in a genealogy.
    const { lines, issues } = lexGedcom('0 @I1@ INDI\r\n2 DATE 1877\r\n');
    expect(issues.map((i) => i.code)).toContain('LEVEL_JUMP');
    expect(lines[1]?.level).toBe(1);
  });

  it('reports a malformed line and keeps going', () => {
    const { lines, issues } = lexGedcom('0 HEAD\r\nrubbish\r\n0 TRLR\r\n');
    expect(issues.map((i) => i.code)).toContain('MISSING_LEVEL');
    // The file still parses. Refusing a 40 MB export over one bad line fails
    // the user, who cannot repair it by hand.
    expect(lines).toHaveLength(2);
  });

  it('never throws, whatever the input', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => lexGedcom(text)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});

describe('parser', () => {
  const document = parseGedcom(SAMPLE);

  it('builds the record tree', () => {
    expect(document.records.filter((r) => r.tag === 'INDI')).toHaveLength(3);
    expect(document.version).toBe('7.0');
    expect(document.byXref.get('@I1@')?.tag).toBe('INDI');
  });

  it('folds CONT into the parent value', () => {
    const parsed = parseGedcom(
      ['0 @I1@ INDI', '1 NOTE Première ligne', '2 CONT Deuxième ligne', '0 TRLR'].join('\r\n'),
    );
    const note = parsed.byXref.get('@I1@')?.children.find((c) => c.tag === 'NOTE');
    expect(note?.value).toBe('Première ligne\nDeuxième ligne');
    // The transport detail does not survive as structure.
    expect(note?.children).toHaveLength(0);
  });

  it('folds CONC without adding a separator', () => {
    const parsed = parseGedcom(
      ['0 @I1@ INDI', '1 NOTE Premi', '2 CONC ère ligne', '0 TRLR'].join('\r\n'),
    );
    expect(parsed.byXref.get('@I1@')?.children[0]?.value).toBe('Première ligne');
  });

  it('keeps the first of two records claiming the same id', () => {
    const parsed = parseGedcom(
      ['0 @I1@ INDI', '1 NAME A //', '0 @I1@ INDI', '1 NAME B //', '0 TRLR'].join('\r\n'),
    );
    expect(parsed.parseIssues.map((i) => i.code)).toContain('DUPLICATE_XREF');
    expect(parsed.byXref.size).toBe(1);
  });

  it('notices a missing header', () => {
    expect(parseGedcom('0 @I1@ INDI\r\n0 TRLR\r\n').parseIssues.map((i) => i.code)).toContain(
      'NO_HEADER',
    );
  });
});

describe('mapper', () => {
  const plan = mapDocument(parseGedcom(SAMPLE));

  it('maps people, names and recorded sex', () => {
    expect(plan.counts.people).toBe(3);
    const jean = plan.people.find((p) => p.xref === '@I1@');
    expect(jean?.names[0]).toMatchObject({ given: 'Jean', surname: 'DUPONT' });
    expect(jean?.recordedSex).toBe('MALE');
  });

  it('keeps the NAME line as written alongside our split', () => {
    // The slash convention breaks on compound surnames and every exporter
    // handles it slightly differently, so the guess must be correctable.
    expect(plan.people[0]?.names[0]?.original).toBe('Jean /DUPONT/');
  });

  it('parses dates through the domain, preserving uncertainty', () => {
    const birth = plan.events.find((e) => e.type === 'BIRTH' && e.participants[0]?.xref === '@I1@');
    expect(formatGenealogicalDate(birth?.date ?? null)).toBe('12 juin 1877');

    const death = plan.events.find((e) => e.type === 'DEATH');
    expect(death?.date?.qualifier).toBe('ABOUT');
    expect(formatGenealogicalDate(death?.date ?? null)).toBe('vers 1945');
  });

  it('reads coordinates with their hemisphere', () => {
    const tours = plan.places.find((p) => p.name.startsWith('Tours,'));
    expect(tours?.latitude).toBeCloseTo(47.3941, 4);
    expect(tours?.longitude).toBeCloseTo(0.6848, 4);
  });

  it('turns a family into directed relationships', () => {
    const parentLinks = plan.relationships.filter((r) => r.type.startsWith('PARENT_'));
    // Two parents, one child: two links, not one family object.
    expect(parentLinks).toHaveLength(2);
    expect(parentLinks.every((r) => r.targetXref === '@I3@')).toBe(true);

    const spouse = plan.relationships.find((r) => r.type === 'SPOUSE');
    expect(spouse?.startJdn).not.toBeNull();
  });

  it('honours a pedigree other than birth', () => {
    const adopted = mapDocument(
      parseGedcom(
        [
          '0 HEAD',
          '1 GEDC',
          '2 VERS 7.0',
          '0 @I1@ INDI',
          '1 NAME A //',
          '0 @I2@ INDI',
          '1 NAME B //',
          '1 FAMC @F1@',
          '2 PEDI ADOPTED',
          '0 @F1@ FAM',
          '1 HUSB @I1@',
          '1 CHIL @I2@',
          '0 TRLR',
        ].join('\r\n'),
      ),
    );
    expect(adopted.relationships[0]?.type).toBe('PARENT_ADOPTIVE');
  });

  it('maps an unknown pedigree to PARENT_UNKNOWN rather than guessing biological', () => {
    const odd = mapDocument(
      parseGedcom(
        [
          '0 HEAD',
          '1 GEDC',
          '2 VERS 7.0',
          '0 @I1@ INDI',
          '1 NAME A //',
          '0 @I2@ INDI',
          '1 NAME B //',
          '1 FAMC @F1@',
          '2 PEDI SOMETHING_ELSE',
          '0 @F1@ FAM',
          '1 HUSB @I1@',
          '1 CHIL @I2@',
          '0 TRLR',
        ].join('\r\n'),
      ),
    );
    expect(odd.relationships[0]?.type).toBe('PARENT_UNKNOWN');
  });

  it('reads a source cited on the family record, not only on the event', () => {
    // Both placements are legal and exporters disagree about which to use.
    // Reading only one silently drops a citation.
    const withFamilySource = mapDocument(
      parseGedcom(
        [
          '0 HEAD',
          '1 GEDC',
          '2 VERS 7.0',
          '0 @I1@ INDI',
          '1 NAME A //',
          '0 @I2@ INDI',
          '1 NAME B //',
          '0 @S1@ SOUR',
          '1 TITL Registre de mariage',
          '0 @F1@ FAM',
          '1 HUSB @I1@',
          '1 WIFE @I2@',
          '1 MARR',
          '2 DATE 1869',
          '1 SOUR @S1@',
          '0 TRLR',
        ].join('\r\n'),
      ),
    );
    const marriage = withFamilySource.events.find((e) => e.type === 'MARRIAGE');
    expect(marriage?.sourceXrefs).toContain('@S1@');
  });

  it('reports a pointer to a record that is not in the file', () => {
    const partial = mapDocument(
      parseGedcom(
        ['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 @F1@ FAM', '1 HUSB @I99@', '0 TRLR'].join('\r\n'),
      ),
    );
    expect(partial.warnings.map((w) => w.code)).toContain('DANGLING_POINTER');
  });

  it('counts and reports an unparseable date instead of dropping it', () => {
    const odd = mapDocument(
      parseGedcom(
        [
          '0 HEAD',
          '1 GEDC',
          '2 VERS 7.0',
          '0 @I1@ INDI',
          '1 NAME A //',
          '1 BIRT',
          '2 DATE 9br 1789',
          '0 TRLR',
        ].join('\r\n'),
      ),
    );
    expect(odd.counts.unparseableDates).toBe(1);
    const warning = odd.warnings.find((w) => w.code === 'UNPARSEABLE_DATE');
    expect(warning?.detail).toBe('9br 1789');
    // The value survives in the date object as well.
    expect(odd.events[0]?.date?.originalText).toBe('9br 1789');
  });

  it('collapses parentage stated twice into one link', () => {
    // A file that states the same parentage in FAM and again through FAMC is
    // making one claim, not two, and the database refuses a duplicate.
    const twice = mapDocument(parseGedcom(SAMPLE));
    const links = twice.relationships.filter(
      (r) => r.sourceXref === '@I1@' && r.targetXref === '@I3@',
    );
    expect(links).toHaveLength(1);
  });

  it('records tags it did not interpret rather than silently dropping them', () => {
    const custom = mapDocument(
      parseGedcom(
        [
          '0 HEAD',
          '1 GEDC',
          '2 VERS 7.0',
          '0 @I1@ INDI',
          '1 NAME A //',
          '1 _MILT Service militaire',
          '0 TRLR',
        ].join('\r\n'),
      ),
    );
    expect(custom.unknownTags).toContain('_MILT');
    expect(custom.people[0]?.unhandledTags).toContain('_MILT');
  });
});

describe('round trip', () => {
  const once = mapDocument(parseGedcom(SAMPLE));
  const written = writeGedcom(once);
  const twice = mapDocument(parseGedcom(written));

  it('produces a file that parses back', () => {
    expect(parseGedcom(written).parseIssues.filter((i) => i.code !== 'NO_RECORDS')).toEqual([]);
    expect(parseGedcom(written).lexIssues).toEqual([]);
  });

  it('keeps every person', () => {
    expect(twice.counts.people).toBe(once.counts.people);
    expect(twice.people.map((p) => p.names[0]?.surname).sort()).toEqual(
      once.people.map((p) => p.names[0]?.surname).sort(),
    );
  });

  it('keeps every relationship, with its type', () => {
    const key = (r: { sourceXref: string; targetXref: string; type: string }) =>
      `${r.sourceXref}|${r.targetXref}|${r.type}`;
    expect(twice.relationships.map(key).sort()).toEqual(once.relationships.map(key).sort());
  });

  it('keeps uncertainty rather than hardening it', () => {
    // "ABT 1945" must not come back as "1945". Silently promoting an
    // approximate date to an exact one is the fake precision the whole
    // product exists to avoid, and an import/export cycle is where it would
    // creep in unnoticed.
    const death = twice.events.find((e) => e.type === 'DEATH');
    expect(death?.date?.qualifier).toBe('ABOUT');
    expect(formatGenealogicalDate(death?.date ?? null)).toBe('vers 1945');
  });

  it('keeps every date interval identical', () => {
    const intervals = (plan: typeof once) =>
      plan.events
        .map(
          (e) =>
            `${e.type}:${e.date?.interval.earliest ?? 'null'}:${e.date?.interval.latest ?? 'null'}`,
        )
        .sort();
    expect(intervals(twice)).toEqual(intervals(once));
  });

  it('is idempotent: writing twice gives the same bytes', () => {
    expect(writeGedcom(twice)).toBe(written);
  });

  it('carries an unreadable date through as a date phrase', () => {
    const odd = mapDocument(
      parseGedcom(
        [
          '0 HEAD',
          '1 GEDC',
          '2 VERS 7.0',
          '0 @I1@ INDI',
          '1 NAME A //',
          '1 BIRT',
          '2 DATE 9br 1789',
          '0 TRLR',
        ].join('\r\n'),
      ),
    );
    const exported = writeGedcom(odd);
    // The specification provides for exactly this: text we cannot structure
    // goes out in parentheses rather than being dropped.
    expect(exported).toContain('(9br 1789)');

    const back = mapDocument(parseGedcom(exported));
    expect(back.events[0]?.date?.originalText).toBe('(9br 1789)');
  });

  it('uses CRLF, as the specification requires', () => {
    expect(written.includes('\r\n')).toBe(true);
    expect(written.endsWith('\r\n')).toBe(true);
  });
});
