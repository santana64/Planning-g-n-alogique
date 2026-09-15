/**
 * Name normalisation.
 *
 * Every normalised column in the database is produced here, and the same
 * folding is applied in SQL by `chronolignee_unaccent`. If the two ever
 * disagree, a stored index entry stops matching the query that should find it
 * and search silently loses people — so this file and the SQL function are a
 * matched pair, and neither changes alone.
 */

/** Fold to lowercase, accent-free, whitespace-collapsed form. */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Particles that precede a surname. Kept out of the sort key so that
 * "de La Tour" files under T, which is how French archives index it, while the
 * displayed name stays intact.
 */
const SURNAME_PARTICLES = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  "d'",
  "l'",
  'van',
  'von',
  'der',
  'den',
  'ter',
  'te',
  'da',
  'di',
  'do',
  'dos',
  'das',
  'del',
  'della',
  'delle',
  'mac',
  'mc',
  "o'",
  'saint',
  'sainte',
  'st',
  'ste',
]);

export function isSurnameParticle(token: string): boolean {
  return SURNAME_PARTICLES.has(foldName(token));
}

/**
 * Split a surname into its particle and its filing root.
 * "de La Tour" -> { particle: "de La", root: "Tour" }
 */
export function splitSurname(surname: string): { particle: string; root: string } {
  const tokens = surname.trim().split(/\s+/).filter(Boolean);
  let cut = 0;
  while (cut < tokens.length - 1 && isSurnameParticle(tokens[cut] as string)) cut += 1;
  return {
    particle: tokens.slice(0, cut).join(' '),
    root: tokens.slice(cut).join(' '),
  };
}

export interface NameInput {
  readonly prefix?: string | null;
  readonly given?: string | null;
  readonly surnamePrefix?: string | null;
  readonly surname?: string | null;
  readonly suffix?: string | null;
  readonly nickname?: string | null;
}

/**
 * Build the display form when a source did not supply one.
 *
 * Surname in caps is the French genealogical convention and is not
 * decoration: in "Jean MARTIN Pierre" it is the only thing telling a reader
 * which token is the family name.
 */
export function buildDisplayForm(name: NameInput): string {
  const parts = [
    name.prefix,
    name.given,
    name.surnamePrefix,
    name.surname ? name.surname.toLocaleUpperCase('fr-FR') : null,
    name.suffix,
  ].filter((p): p is string => Boolean(p && p.trim()));

  const base = parts.join(' ').replace(/\s+/g, ' ').trim();
  return base || 'Personne sans nom';
}

/** The value stored in `Person.searchName`. */
export function buildSearchName(name: NameInput): string {
  return foldName(
    [name.given, name.surnamePrefix, name.surname, name.nickname].filter(Boolean).join(' '),
  );
}

/** The value stored in `PersonName.normalisedSurname` — filing root only. */
export function normaliseSurname(surname: string | null | undefined): string {
  if (!surname) return '';
  return foldName(splitSurname(surname).root || surname);
}

export function normaliseGiven(given: string | null | undefined): string {
  return given ? foldName(given) : '';
}

/** The value stored in `Place.normalisedName`. */
export function normalisePlaceName(name: string): string {
  return foldName(name);
}
