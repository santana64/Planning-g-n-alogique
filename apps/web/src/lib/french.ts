const VOWEL = /^[aeiouyàâäéèêëîïôöùûüœæ]/i;

/** "de Paul", "d’Émile". */
export function ofName(name: string): string {
  return VOWEL.test(name) ? `d’${name}` : `de ${name}`;
}
