const VOWEL = /^[aeiouyàâäéèêëîïôöùûüœæ]/i;

/** "de Paul", "d’Émile". */
export function ofName(name: string): string {
  return VOWEL.test(name) ? `d’${name}` : `de ${name}`;
}

/**
 * The same, when the sentence around it is French.
 *
 * Elision is a French rule. An English sentence supplies its own preposition
 * and takes the name as it is, so its message says "the record of {of}" and
 * this hands it the bare name.
 */
export function ofNameIn(locale: string, name: string): string {
  return locale.startsWith('fr') ? ofName(name) : name;
}
