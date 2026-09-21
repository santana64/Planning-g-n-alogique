import type { Finding } from '@chronolignee/genealogy';

/**
 * Findings, as a sentence in the reader's language.
 *
 * The validator emits a code and parameters, never a sentence — a finding
 * produced in a worker has to render in whichever locale the reader is using,
 * and a rendered string cannot be re-rendered. This is where the sentence is
 * chosen, and it is the only place.
 *
 * What lives here is the *choice*: which message, with which values, and in
 * particular which name goes in which slot. The wording itself lives in the
 * catalogues (`messages/*.json`, namespace `findings`), because two languages
 * do not put the words in the same order.
 *
 * Two rules the wording follows, in every language:
 *
 *  - A POSSIBLE finding says so. The validator already knows the difference
 *    between "this is wrong" and "the dates are loose enough that this might
 *    be wrong", and dropping that word in the message throws away the
 *    distinction the whole trivalent model exists to preserve.
 *  - Nothing here tells the user their data is wrong. "Mother aged 58" is a
 *    fact about the record; it is not an accusation, because it happens.
 */

export type Values = Readonly<Record<string, string | number>>;

/** What a translator has to be, from this module's point of view. */
export type FindingTranslator = (key: string, values?: Values) => string;

export interface FindingText {
  /** A key in the `findings` namespace. */
  readonly key: string;
  readonly values: Values;
}

/**
 * The entity order each code uses.
 *
 * Not a convention worth guessing at: the validator's parent/child findings
 * put the CHILD first, because the child is the record a reviewer is looking
 * at. Reading them the other way round produced "Hippolyte would be 57 at the
 * birth of Victoire" — a sentence that sends the researcher to correct the
 * wrong person's dates. Naming the roles here is what keeps that honest.
 */
export function findingText(finding: Finding, unknownPerson: string): FindingText {
  const p: Values = finding.params ?? {};
  const first = finding.entities[0]?.label ?? unknownPerson;
  const second = finding.entities[1]?.label ?? unknownPerson;

  // For every finding produced by checkParentChildPlausibility.
  const child = first;
  const parent = second;

  switch (finding.code) {
    case 'CHILD_BORN_BEFORE_PARENT':
      return typeof p['days'] === 'number'
        ? {
            key: 'CHILD_BORN_BEFORE_PARENT_WITH_DAYS',
            values: { child, parent, days: Math.abs(p['days']) },
          }
        : { key: 'CHILD_BORN_BEFORE_PARENT', values: { child, parent } };
    case 'BIRTH_AFTER_MOTHER_DEATH':
    case 'POSTHUMOUS_BIRTH':
      return { key: finding.code, values: { child, parent, days: p['days'] ?? '?' } };
    case 'PARENT_TOO_YOUNG':
    case 'MOTHER_TOO_OLD':
    case 'FATHER_TOO_OLD':
      return {
        key: finding.code,
        values: { child, parent, age: p['age'] ?? '?', threshold: p['threshold'] ?? '?' },
      };
    case 'LIFESPAN_IMPLAUSIBLE':
      return {
        key: finding.code,
        values: { first, years: p['years'] ?? '?', threshold: p['threshold'] ?? '?' },
      };
    case 'MARRIED_TOO_YOUNG':
      return { key: finding.code, values: { first, age: p['age'] ?? '?' } };
    case 'SIBLINGS_BORN_TOO_CLOSE':
      return { key: finding.code, values: { first, second, days: p['days'] ?? '?' } };
    case 'DUPLICATE_RELATIONSHIP':
    case 'DUPLICATE_CANDIDATE':
      return { key: finding.code, values: { first, second } };
    case 'CUSTOM_EVENT_UNLABELLED':
      return { key: finding.code, values: {} };
    default:
      return { key: finding.code, values: { first } };
  }
}

/** The sentence itself, uncertainty included. */
export function findingMessage(t: FindingTranslator, finding: Finding): string {
  const text = findingText(finding, t('unknownPerson'));
  const sentence = t(text.key, text.values);
  // "Probably" is not softening: the dates genuinely permit both readings,
  // and stating it flatly would be a claim the evidence does not support.
  return finding.certainty === 'POSSIBLE' ? t('possible', { sentence }) : sentence;
}

/** ERROR, WARNING, INFO — as the record page labels them. */
export function severityLabel(t: FindingTranslator, severity: Finding['severity']): string {
  return t(`severity.${severity}`);
}
