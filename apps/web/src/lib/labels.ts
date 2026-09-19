/**
 * The names the interface gives to the model's codes.
 *
 * Pure, so the history, the record page and the editors share one wording and
 * a unit test can read them without a database.
 */

export const EVENT_LABELS: Record<string, string> = {
  BIRTH: 'Naissance',
  BAPTISM: 'Baptême',
  DEATH: 'Décès',
  BURIAL: 'Inhumation',
  CREMATION: 'Crémation',
  MARRIAGE: 'Mariage',
  MARRIAGE_BANN: 'Publication des bans',
  MARRIAGE_CONTRACT: 'Contrat de mariage',
  CIVIL_UNION: 'Union civile',
  DIVORCE: 'Divorce',
  RESIDENCE: 'Résidence',
  OCCUPATION: 'Profession',
  EDUCATION: 'Études',
  MILITARY_SERVICE: 'Service militaire',
  MIGRATION: 'Migration',
  NATURALIZATION: 'Naturalisation',
  CENSUS: 'Recensement',
  PROBATE: 'Succession',
  WILL: 'Testament',
  RELIGIOUS_EVENT: 'Événement religieux',
  CUSTOM: 'Autre',
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  PARENT_BIOLOGICAL: 'Parent biologique',
  PARENT_ADOPTIVE: 'Parent adoptif',
  PARENT_FOSTER: 'Parent nourricier',
  PARENT_STEP: 'Beau-parent',
  PARENT_GUARDIAN: 'Tuteur',
  PARENT_UNKNOWN: 'Parent, lien non précisé',
  SPOUSE: 'Époux / épouse',
  PARTNER: 'Partenaire',
  DIVORCED_PARTNER: 'Ex-conjoint',
  SIBLING: 'Frère / sœur',
  OTHER: 'Autre',
};

export const CLAIM_LABELS: Record<string, string> = {
  NAME: 'nom',
  RECORDED_SEX: 'sexe',
  BIRTH_DATE: 'date de naissance',
  BIRTH_PLACE: 'lieu de naissance',
  DEATH_DATE: 'date de décès',
  DEATH_PLACE: 'lieu de décès',
  BAPTISM_DATE: 'date de baptême',
  BURIAL_DATE: 'date d’inhumation',
  MARRIAGE_DATE: 'date de mariage',
  MARRIAGE_PLACE: 'lieu de mariage',
  OCCUPATION: 'profession',
  RESIDENCE: 'résidence',
  PARENT: 'parent',
  SPOUSE: 'conjoint',
  CHILD: 'enfant',
  MIGRATION: 'migration',
  MILITARY_SERVICE: 'service militaire',
  EDUCATION: 'études',
  RELIGION: 'religion',
  NOTE: 'note',
  OTHER: 'autre',
};
