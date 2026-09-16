import type { Finding } from '@chronolignee/genealogy';

/**
 * Findings, in French.
 *
 * The validator emits a code and parameters, never a sentence — a finding
 * produced in a worker has to render in whichever locale the reader is using,
 * and a rendered string cannot be re-rendered. This is where the sentence is
 * made, and it is the only place.
 *
 * Two rules the wording follows:
 *
 *  - A POSSIBLE finding says "peut-être". The validator already knows the
 *    difference between "this is wrong" and "the dates are loose enough that
 *    this might be wrong", and dropping that word in the message throws away
 *    the distinction the whole trivalent model exists to preserve.
 *  - Nothing here tells the user their data is wrong. "Mère âgée de 58 ans"
 *    is a fact about the record; it is not an accusation, because it happens.
 */

type Params = Readonly<Record<string, string | number>>;

function nameOf(finding: Finding, index: number): string {
  return finding.entities[index]?.label ?? 'cette personne';
}

/**
 * The entity order each code uses.
 *
 * Not a convention worth guessing at: the validator's parent/child findings
 * put the CHILD first, because the child is the record a reviewer is looking
 * at. Reading them the other way round produced "Hippolyte aurait 57 ans à la
 * naissance de Victoire" — a sentence that sends the researcher to correct
 * the wrong person's dates. Naming the roles here is what keeps that honest.
 */
function describe(finding: Finding): string {
  const p: Params = finding.params ?? {};
  const first = nameOf(finding, 0);
  const second = nameOf(finding, 1);

  // For every finding produced by checkParentChildPlausibility.
  const child = first;
  const parent = second;

  switch (finding.code) {
    case 'SELF_RELATIONSHIP':
      return `${first} ne peut pas être en relation avec elle-même.`;
    case 'ANCESTRY_CYCLE':
      return `Boucle d'ascendance : ${first} finit par être son propre ancêtre.`;
    case 'DUPLICATE_RELATIONSHIP':
      return `Ce lien existe déjà entre ${first} et ${second}.`;
    case 'DEATH_BEFORE_BIRTH':
      return `${first} : le décès précède la naissance.`;
    case 'CHILD_BORN_BEFORE_PARENT':
      return typeof p['days'] === 'number'
        ? `${child} naît ${Math.abs(p['days'])} jours avant ${parent}, son parent.`
        : `${child} naît avant ${parent}, son parent.`;
    case 'BIRTH_AFTER_MOTHER_DEATH':
      return `${child} naît ${p['days'] ?? '?'} jours après le décès de sa mère ${parent}.`;
    case 'EVENT_OUTSIDE_LIFESPAN':
      return `Un événement de ${first} se situe hors de sa vie.`;
    case 'CUSTOM_EVENT_UNLABELLED':
      return 'Un événement personnalisé est sans intitulé.';
    case 'PARENT_TOO_YOUNG':
      return `${parent} aurait ${p['age'] ?? '?'} ans à la naissance de ${child} (seuil : ${p['threshold'] ?? '?'}).`;
    case 'MOTHER_TOO_OLD':
      return `${parent} aurait ${p['age'] ?? '?'} ans à la naissance de ${child} (seuil : ${p['threshold'] ?? '?'}).`;
    case 'FATHER_TOO_OLD':
      return `${parent} aurait ${p['age'] ?? '?'} ans à la naissance de ${child} (seuil : ${p['threshold'] ?? '?'}).`;
    case 'LIFESPAN_IMPLAUSIBLE':
      return `${first} vivrait ${p['years'] ?? '?'} ans (seuil : ${p['threshold'] ?? '?'}).`;
    case 'MARRIAGE_BEFORE_BIRTH':
      return `${first} se marie avant sa naissance.`;
    case 'MARRIAGE_AFTER_DEATH':
      return `${first} se marie après son décès.`;
    case 'MARRIED_TOO_YOUNG':
      return `${first} se marie à ${p['age'] ?? '?'} ans.`;
    case 'POSTHUMOUS_BIRTH':
      return `${child} naît ${p['days'] ?? '?'} jours après le décès de son père ${parent}.`;
    case 'CONTRADICTORY_ACCEPTED_CLAIMS':
      return `${first} porte deux affirmations acceptées qui se contredisent.`;
    case 'DUPLICATE_CANDIDATE':
      return `${first} et ${second} pourraient être la même personne.`;
    case 'SIBLINGS_BORN_TOO_CLOSE':
      return `${first} et ${second} naissent à ${p['days'] ?? '?'} jours d'intervalle.`;
    case 'DISCONNECTED_COMPONENT':
      return `${first} n'est rattachée à personne dans cet arbre.`;
    case 'NO_TEMPORAL_EVIDENCE':
      return `${first} n'a aucune date : elle ne peut pas être placée sur la chronologie.`;
    case 'CLAIM_WITHOUT_CITATION':
      return `Une affirmation sur ${first} ne cite aucune source.`;
    case 'PEDIGREE_COLLAPSE':
      return `${first} apparaît plusieurs fois dans la même ascendance.`;
  }
}

export function findingMessage(finding: Finding): string {
  const sentence = describe(finding);
  // "Probablement" is not softening: the dates genuinely permit both readings,
  // and stating it flatly would be a claim the evidence does not support.
  return finding.certainty === 'POSSIBLE' ? `Probablement : ${sentence}` : sentence;
}

export const SEVERITY_LABELS: Record<Finding['severity'], string> = {
  ERROR: 'Impossible',
  WARNING: 'À vérifier',
  INFO: 'À noter',
};
