import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeAnsel, decodeGedcom } from './decode';
import { mapDocument } from './mapper';
import { parseGedcom } from './parser';

/** A small file whose one name needs an accent, in whatever bytes the test gives. */
function gedcom(charset: string | null, surname: number[]): Uint8Array {
  const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
  return new Uint8Array([
    ...ascii(
      `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n${charset ? `1 CHAR ${charset}\n` : ''}0 @I1@ INDI\n1 NAME Jean /`,
    ),
    ...surname,
    ...ascii('/\n0 TRLR\n'),
  ]);
}

function surnameOf(bytes: Uint8Array): string | undefined {
  const result = decodeGedcom(bytes);
  if (!result.ok) throw new Error('refused');
  return mapDocument(parseGedcom(result.value.text)).people[0]?.names[0]?.surname;
}

const utf8 = (text: string) => [...new TextEncoder().encode(text)];

describe('decodeGedcom', () => {
  it('reads UTF-8, with or without a byte-order mark', () => {
    expect(surnameOf(gedcom('UTF-8', utf8('LEFÈVRE')))).toBe('LEFÈVRE');
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...gedcom('UTF-8', utf8('LEFÈVRE'))]);
    const result = decodeGedcom(withBom);
    expect(result.ok && result.value.encoding).toBe('UTF-8');
    expect(surnameOf(withBom)).toBe('LEFÈVRE');
  });

  it('reads Windows-1252 when the file says ANSI, instead of turning accents into U+FFFD', () => {
    const bytes = gedcom('ANSI', [0x4c, 0x45, 0x46, 0xc8, 0x56, 0x52, 0x45]);
    const result = decodeGedcom(bytes);
    expect(result).toMatchObject({
      ok: true,
      value: { encoding: 'WINDOWS-1252', declared: 'ANSI', guessed: false },
    });
    expect(surnameOf(bytes)).toBe('LEFÈVRE');
  });

  it('reads ANSEL, putting each accent after its letter and composing it', () => {
    // E1 is a grave accent, written before the E it belongs to.
    const bytes = gedcom('ANSEL', [0x4c, 0x45, 0x46, 0xe1, 0x45, 0x56, 0x52, 0x45]);
    expect(decodeGedcom(bytes)).toMatchObject({ ok: true, value: { encoding: 'ANSEL' } });
    expect(surnameOf(bytes)).toBe('LEFÈVRE');
    expect(surnameOf(bytes)?.length).toBe(7);
  });

  it('decodes ANSEL marks and letters', () => {
    const ansel = (...codes: number[]) => decodeAnsel(new Uint8Array(codes));
    expect(ansel(0x46, 0x72, 0x61, 0x6e, 0xf0, 0x63, 0x6f, 0x69, 0x73)).toBe('François');
    expect(ansel(0xe2, 0x45, 0x6c, 0xe8, 0x6f, 0x64, 0x69, 0x65)).toBe('Élödie');
    expect(ansel(0xa5, 0x6c, 0x66, 0xb6)).toBe('Ælfœ');
    // A mark followed by a line break stays on its own line.
    expect(ansel(0x61, 0xe2, 0x0a, 0x31)).toBe('a\u0301\n1'.normalize('NFC'));
  });

  it('trusts valid UTF-8 over a header that says otherwise', () => {
    // Exporters write "CHAR ANSEL" over UTF-8 content often enough to matter.
    const result = decodeGedcom(gedcom('ANSEL', utf8('LEFÈVRE')));
    expect(result).toMatchObject({ ok: true, value: { encoding: 'UTF-8', declared: 'ANSEL' } });
  });

  it('reads UTF-16, with a byte-order mark or without', () => {
    const text = '0 HEAD\n1 CHAR UNICODE\n0 @I1@ INDI\n1 NAME Jean /LEFÈVRE/\n0 TRLR\n';
    const littleEndian = new Uint8Array(text.length * 2);
    const bigEndian = new Uint8Array(text.length * 2);
    [...text].forEach((character, index) => {
      const code = character.charCodeAt(0);
      littleEndian[index * 2] = code & 0xff;
      littleEndian[index * 2 + 1] = code >> 8;
      bigEndian[index * 2] = code >> 8;
      bigEndian[index * 2 + 1] = code & 0xff;
    });
    expect(surnameOf(littleEndian)).toBe('LEFÈVRE');
    expect(surnameOf(bigEndian)).toBe('LEFÈVRE');
    expect(surnameOf(new Uint8Array([0xff, 0xfe, ...littleEndian]))).toBe('LEFÈVRE');
    expect(decodeGedcom(bigEndian)).toMatchObject({
      ok: true,
      value: { encoding: 'UTF-16BE', declared: 'UNICODE' },
    });
  });

  it('says when it had to guess', () => {
    const result = decodeGedcom(gedcom(null, [0x4c, 0x45, 0x46, 0xc8, 0x56, 0x52, 0x45]));
    expect(result).toMatchObject({
      ok: true,
      value: { encoding: 'WINDOWS-1252', declared: null, guessed: true },
    });
    // Declared UTF-8 but not UTF-8: the same guess, still flagged.
    expect(decodeGedcom(gedcom('UTF-8', [0x4c, 0xc8]))).toMatchObject({
      ok: true,
      value: { guessed: true },
    });
  });

  it('refuses a DOS code page it cannot read faithfully', () => {
    expect(decodeGedcom(gedcom('IBMPC', [0x4c, 0x90, 0x56]))).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_ENCODING',
      declared: 'IBMPC',
    });
  });

  it('reads an ASCII file the same whatever it declares', () => {
    for (const charset of ['ANSEL', 'ANSI', 'ASCII', 'IBMPC', null]) {
      expect(surnameOf(gedcom(charset, utf8('DUPONT')))).toBe('DUPONT');
    }
  });

  it('round-trips any Latin-1 name through Windows-1252', () => {
    const latin1 = fc
      .array(fc.oneof(fc.integer({ min: 0x41, max: 0x5a }), fc.integer({ min: 0xc0, max: 0xff })), {
        minLength: 1,
        maxLength: 20,
      })
      .filter((codes) => codes.some((code) => code >= 0xc0));
    fc.assert(
      fc.property(latin1, (codes) => {
        const expected = String.fromCharCode(...codes);
        expect(surnameOf(gedcom('ANSI', codes))).toBe(expected);
      }),
    );
  });
});
