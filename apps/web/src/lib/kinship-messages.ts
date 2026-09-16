import type { Kinship } from '@chronolignee/genealogy';

/**
 * Kinship, in French.
 *
 * French names these relations by their own rules, and the rules are not a
 * translation of the English ones. "Cousin issu de germain" is a second
 * cousin; "cousin germain au second degré" is something else entirely and is
 * a common mistranslation. Degrees are spelled out to the fourth because that
 * is where genealogical usage stops being ordinal and starts being numeric.
 *
 * Sex is not guessed. Where French would normally gender the word — cousin /
 * cousine, oncle / tante — the recorded sex may be unknown, and inventing one
 * to make a sentence read smoothly is exactly the fake precision this product
 * refuses. The neutral form is used unless the record says otherwise.
 */

export type KinshipSex = 'MALE' | 'FEMALE' | 'INTERSEX' | 'UNKNOWN';

/** "arrière-arrière-…" past the third generation, as French actually builds it. */
function ascendantTerm(generations: number, sex: KinshipSex): string {
  const gendered = (neutral: string, male: string, female: string): string =>
    sex === 'MALE' ? male : sex === 'FEMALE' ? female : neutral;

  if (generations === 1) return gendered('parent', 'père', 'mère');
  if (generations === 2) return gendered('grand-parent', 'grand-père', 'grand-mère');

  const prefix = 'arrière-'.repeat(generations - 2);
  return `${prefix}${gendered('grand-parent', 'grand-père', 'grand-mère')}`;
}

function descendantTerm(generations: number, sex: KinshipSex): string {
  const gendered = (neutral: string, male: string, female: string): string =>
    sex === 'MALE' ? male : sex === 'FEMALE' ? female : neutral;

  if (generations === 1) return gendered('enfant', 'fils', 'fille');
  if (generations === 2) return gendered('petit-enfant', 'petit-fils', 'petite-fille');

  const prefix = 'arrière-'.repeat(generations - 2);
  return `${prefix}${gendered('petit-enfant', 'petit-fils', 'petite-fille')}`;
}

/**
 * The qualifier, agreeing with the noun it follows.
 *
 * "Germain" and "issu" are adjectives and inflect: a woman is a cousine
 * germaine, not a cousine germain. With the sex unknown the phrase is
 * coordinated ("cousin ou cousine"), and French lets the adjective agree with
 * the nearest noun — which is the feminine one — rather than forcing a guess
 * about the person.
 *
 * From the third degree onward the qualifier stops being an adjective and
 * becomes a number, so it no longer inflects.
 */
function cousinDegree(degree: number, sex: KinshipSex): string {
  const feminine = sex !== 'MALE';
  if (degree === 1) return feminine ? 'germaine' : 'germain';
  if (degree === 2) return feminine ? 'issue de germain' : 'issu de germain';
  if (degree === 3) return 'au troisième degré';
  if (degree === 4) return 'au quatrième degré';
  return `au ${degree}e degré`;
}

function removalSuffix(removal: number): string {
  if (removal === 0) return '';
  if (removal === 1) return ', à un degré d’écart';
  return `, à ${removal} degrés d’écart`;
}

/**
 * The relation, from the subject's point of view.
 *
 * "X est votre grand-père" rather than "vous et X partagent un ancêtre" —
 * the second is what the graph computed and the first is what was asked.
 */
export function kinshipLabel(relation: Kinship, otherSex: KinshipSex = 'UNKNOWN'): string {
  switch (relation.code) {
    case 'SELF':
      return 'La même personne';
    case 'PARTNER':
      return otherSex === 'MALE'
        ? 'Époux ou compagnon'
        : otherSex === 'FEMALE'
          ? 'Épouse ou compagne'
          : 'Conjoint';
    case 'DESCENDANT':
      // The other person is above the subject: they are the subject's ancestor.
      return capitalise(ascendantTerm(relation.up, otherSex));
    case 'ANCESTOR':
      return capitalise(descendantTerm(relation.down, otherSex));
    case 'SIBLING':
      return otherSex === 'MALE' ? 'Frère' : otherSex === 'FEMALE' ? 'Sœur' : 'Frère ou sœur';
    case 'PIBLING': {
      // Uncle, great-uncle, and so on: one step off the direct line.
      const greats = 'grand-'.repeat(Math.max(0, relation.up - 2));
      const base =
        otherSex === 'MALE' ? 'oncle' : otherSex === 'FEMALE' ? 'tante' : 'oncle ou tante';
      return capitalise(`${greats}${base}`);
    }
    case 'NIBLING': {
      const greats = 'petit-'.repeat(Math.max(0, relation.down - 2));
      const base =
        otherSex === 'MALE' ? 'neveu' : otherSex === 'FEMALE' ? 'nièce' : 'neveu ou nièce';
      return capitalise(`${greats}${base}`);
    }
    case 'COUSIN': {
      const base =
        otherSex === 'FEMALE' ? 'Cousine' : otherSex === 'MALE' ? 'Cousin' : 'Cousin ou cousine';
      return `${base} ${cousinDegree(relation.degree, otherSex)}${removalSuffix(relation.removal)}`;
    }
    case 'UNRELATED':
      return 'Aucun lien trouvé dans cet arbre';
  }
}

function capitalise(value: string): string {
  return value.charAt(0).toLocaleUpperCase('fr-FR') + value.slice(1);
}

/** The sentence naming the shared ancestors, or empty when there are none. */
export function kinshipThrough(names: readonly string[]): string {
  const real = names.filter(Boolean);
  if (real.length === 0) return '';
  if (real.length === 1) return `par ${real[0]}`;
  return `par ${real.slice(0, -1).join(', ')} et ${real[real.length - 1]}`;
}
