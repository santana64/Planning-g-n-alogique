/**
 * Bytes to text, in the encoding the file is actually written in.
 *
 * GEDCOM 7 is UTF-8, and nothing else. The files people actually have are
 * often older: GEDCOM 5.5 allowed ANSEL, a library character set in which an
 * accent is a byte of its own written before its letter, and French genealogy
 * software long wrote "ANSI" — Windows-1252 in practice. Decoding either as
 * UTF-8 does not fail. It turns every accented letter into U+FFFD, silently,
 * in every name of the file: "LEFÈVRE" becomes "LEF�VRE" and stays that way in
 * the tree.
 *
 * So the bytes decide and the header only advises. A file that is valid UTF-8
 * is read as UTF-8 whatever it declares — mislabelled exports are common, and
 * accented text in any other encoding is essentially never valid UTF-8. A file
 * that is not is read in the encoding it declares. One that declares nothing
 * usable is read as Windows-1252 and says it guessed. One in an encoding this
 * cannot read faithfully is refused: a garbled import is worse than none,
 * because nobody notices it until the names have been copied everywhere.
 */

export const GEDCOM_ENCODINGS = [
  'UTF-8',
  'UTF-16LE',
  'UTF-16BE',
  'WINDOWS-1252',
  'MACINTOSH',
  'ANSEL',
] as const;
export type GedcomEncoding = (typeof GEDCOM_ENCODINGS)[number];

export interface DecodedGedcom {
  readonly text: string;
  readonly encoding: GedcomEncoding;
  /** The header's CHAR value, verbatim, when there is one. */
  readonly declared: string | null;
  /** True when neither the bytes nor the header said which encoding this is. */
  readonly guessed: boolean;
}

export type DecodeResult =
  | { readonly ok: true; readonly value: DecodedGedcom }
  | {
      readonly ok: false;
      readonly reason: 'UNSUPPORTED_ENCODING';
      readonly declared: string | null;
    };

/** Enough of the file to hold its header, which is ASCII in every encoding but UTF-16. */
const HEADER_BYTES = 4096;

/** Declared names, normalised to upper case without spaces, dashes or underscores. */
const WINDOWS_1252_NAMES = new Set([
  'ANSI',
  'ASCII',
  'ISO88591',
  'LATIN1',
  'WINDOWS1252',
  'CP1252',
  'IBMWINDOWS',
]);
const MACINTOSH_NAMES = new Set(['MACINTOSH', 'MAC', 'MACROMAN']);
/** DOS code pages: no decoder here maps their accented letters faithfully. */
const UNSUPPORTED_NAMES = new Set(['IBMPC', 'IBMDOS', 'DOS', 'CP437', 'CP850', 'OEM']);

function normaliseName(declared: string): string {
  return declared.toUpperCase().replace(/[\s_-]/g, '');
}

function declaredCharset(
  bytes: Uint8Array,
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be',
): string | null {
  const head = new TextDecoder(encoding === 'utf-8' ? 'windows-1252' : encoding).decode(
    bytes.subarray(0, HEADER_BYTES),
  );
  return /^\s*1\s+CHAR\s+(\S[^\r\n]*?)\s*$/m.exec(head)?.[1] ?? null;
}

/** UTF-16 without a byte-order mark still starts "0 HEAD", one zero byte per character. */
function utf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x30 && bytes[1] === 0x00 && bytes[3] === 0x00) return 'utf-16le';
  if (bytes[0] === 0x00 && bytes[1] === 0x30 && bytes[2] === 0x00) return 'utf-16be';
  return null;
}

function strictUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeGedcom(bytes: Uint8Array): DecodeResult {
  // A byte-order mark is the one declaration that cannot be wrong.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decoded(
      new TextDecoder('utf-8').decode(bytes),
      'UTF-8',
      declaredCharset(bytes, 'utf-8'),
    );
  }
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : utf16WithoutBom(bytes);
  if (utf16) {
    return decoded(
      new TextDecoder(utf16).decode(bytes),
      utf16 === 'utf-16le' ? 'UTF-16LE' : 'UTF-16BE',
      declaredCharset(bytes, utf16),
    );
  }

  const declared = declaredCharset(bytes, 'utf-8');
  const utf8 = strictUtf8(bytes);
  if (utf8 !== null) return decoded(utf8, 'UTF-8', declared);

  const name = declared === null ? null : normaliseName(declared);
  if (name === 'ANSEL') return decoded(decodeAnsel(bytes), 'ANSEL', declared);
  if (name !== null && WINDOWS_1252_NAMES.has(name)) {
    return decoded(new TextDecoder('windows-1252').decode(bytes), 'WINDOWS-1252', declared);
  }
  if (name !== null && MACINTOSH_NAMES.has(name)) {
    return decoded(new TextDecoder('macintosh').decode(bytes), 'MACINTOSH', declared);
  }
  if (name !== null && UNSUPPORTED_NAMES.has(name)) {
    return { ok: false, reason: 'UNSUPPORTED_ENCODING', declared };
  }
  // Undeclared, or declared as UTF-8 and not: Windows-1252 is what such a
  // file almost always is in practice, and every byte decodes to something
  // — but it is a guess, and the review says so.
  return {
    ok: true,
    value: {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'WINDOWS-1252',
      declared,
      guessed: true,
    },
  };
}

function decoded(text: string, encoding: GedcomEncoding, declared: string | null): DecodeResult {
  return { ok: true, value: { text, encoding, declared, guessed: false } };
}

// --- ANSEL (ANSI Z39.47, with the GEDCOM 5.5 additions) ---------------------

/** Letters and signs in the upper half. */
const ANSEL_CHARACTERS: Readonly<Record<number, string>> = {
  0x8d: '\u200d',
  0x8e: '\u200c',
  0xa1: 'Ł',
  0xa2: 'Ø',
  0xa3: 'Đ',
  0xa4: 'Þ',
  0xa5: 'Æ',
  0xa6: 'Œ',
  0xa7: 'ʹ',
  0xa8: '·',
  0xa9: '♭',
  0xaa: '®',
  0xab: '±',
  0xac: 'Ơ',
  0xad: 'Ư',
  0xae: 'ʼ',
  0xb0: 'ʻ',
  0xb1: 'ł',
  0xb2: 'ø',
  0xb3: 'đ',
  0xb4: 'þ',
  0xb5: 'æ',
  0xb6: 'œ',
  0xb7: 'ʺ',
  0xb8: 'ı',
  0xb9: '£',
  0xba: 'ð',
  0xbc: 'ơ',
  0xbd: 'ư',
  0xbe: '□',
  0xbf: '■',
  0xc0: '°',
  0xc1: 'ℓ',
  0xc2: '℗',
  0xc3: '©',
  0xc4: '♯',
  0xc5: '¿',
  0xc6: '¡',
  0xc7: 'ß',
  0xc8: '€',
  0xcd: 'e',
  0xce: 'o',
  0xcf: 'ß',
};

/** Combining marks. In ANSEL they come before the letter they sit on. */
const ANSEL_MARKS: Readonly<Record<number, string>> = {
  0xe0: '\u0309',
  0xe1: '\u0300',
  0xe2: '\u0301',
  0xe3: '\u0302',
  0xe4: '\u0303',
  0xe5: '\u0304',
  0xe6: '\u0306',
  0xe7: '\u0307',
  0xe8: '\u0308',
  0xe9: '\u030c',
  0xea: '\u030a',
  0xeb: '\ufe20',
  0xec: '\ufe21',
  0xed: '\u0315',
  0xee: '\u030b',
  0xef: '\u0310',
  0xf0: '\u0327',
  0xf1: '\u0328',
  0xf2: '\u0323',
  0xf3: '\u0324',
  0xf4: '\u0325',
  0xf5: '\u0333',
  0xf6: '\u0332',
  0xf7: '\u0326',
  0xf8: '\u031c',
  0xf9: '\u032e',
  0xfa: '\ufe22',
  0xfb: '\ufe23',
  0xfe: '\u0313',
};

/**
 * ANSEL to Unicode.
 *
 * Unicode puts a combining mark after its letter, ANSEL before it, so marks
 * are held until their letter arrives and the result is composed: "e" plus a
 * grave accent becomes the single "è" a search for "Lefèvre" will match.
 * A mark left before a line break stays on the line it was written on rather
 * than migrating to the start of the next, where it would break the line's
 * level number.
 */
export function decodeAnsel(bytes: Uint8Array): string {
  let text = '';
  let marks = '';
  for (const byte of bytes) {
    const mark = ANSEL_MARKS[byte];
    if (mark !== undefined) {
      marks += mark;
      continue;
    }
    const character = byte < 0x80 ? String.fromCharCode(byte) : (ANSEL_CHARACTERS[byte] ?? '�');
    text += byte < 0x20 ? marks + character : character + marks;
    marks = '';
  }
  return (text + marks).normalize('NFC');
}
