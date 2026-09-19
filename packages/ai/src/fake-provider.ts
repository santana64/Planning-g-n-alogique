import { PROMPT_VERSION } from './prompt';
import {
  PIPELINE_VERSION,
  verifyExtraction,
  type ExtractionOutput,
  type ExtractionResult,
} from './extraction';
import { assertExtractable, type AIProvider, type ExtractionRequest } from './provider';
import {
  STORY_SELECTION_VERSION,
  assertSelectable,
  validateStorySelection,
  type StorySelectionRequest,
  type StorySelectionResult,
} from './story-selection';

/**
 * The deterministic test double.
 *
 * Reads the handful of phrasings that make up most French civil-register
 * entries — "né le", "fils de … et de …", "décédé le", "Pierre X, tonnelier"
 * — with regular expressions, and nothing else. It exists so that CI, local
 * development and the end-to-end suite exercise the whole proposal loop
 * without sending a word anywhere or spending anything.
 *
 * Its limits are the point of it: it is predictable, so a test can assert
 * exactly what it proposes; and it is labelled as what it is on every
 * proposal it produces, so nobody mistakes a regular expression for a reading.
 * Production refuses to start with it (see packages/config).
 */

const MONTHS: Record<string, string> = {
  janvier: 'JAN',
  fevrier: 'FEB',
  mars: 'MAR',
  avril: 'APR',
  mai: 'MAY',
  juin: 'JUN',
  juillet: 'JUL',
  aout: 'AUG',
  septembre: 'SEP',
  octobre: 'OCT',
  novembre: 'NOV',
  decembre: 'DEC',
};

const MONTH_PATTERN =
  '(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)';

/** "12 juin 1822", "1er mars 1790" — digits for day and year, a month in words. */
const DATE_PATTERN = `(1er|\\d{1,2})\\s+${MONTH_PATTERN}\\s+(\\d{4})`;

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function toGedcom(day: string, month: string, year: string): string | null {
  const code = MONTHS[stripAccents(month.toLowerCase())];
  if (!code) return null;
  const dayNumber = day === '1er' ? 1 : Number.parseInt(day, 10);
  if (!Number.isFinite(dayNumber) || dayNumber < 1 || dayNumber > 31) return null;
  return `${dayNumber} ${code} ${year}`;
}

/** A capitalised name of one to four words, as clerks write them. */
const NAME = "[A-ZÀ-Ý][\\p{L}'’-]+(?:\\s+[A-ZÀ-Ý][\\p{L}'’-]+){0,3}";

/**
 * Trades common enough in the registers to recognise without a model.
 * A closed list on purpose: "X, habitant de cette commune" is not an
 * occupation, and a pattern that matched any word after a comma would say
 * it was.
 */
const OCCUPATIONS =
  'tonnelier|vigneron|cultivateur|laboureur|journalier|journali[èe]re|marchand|marchande|boulanger|meunier|mar[ée]chal|charpentier|menuisier|tisserand|tisserande|couturi[èe]re|lingère|domestique|instituteur|institutrice|notaire|propri[ée]taire|cordonnier|forgeron|ma[çc]on|charron|aubergiste|militaire|soldat|rentier|rentière';

export class FakeAIProvider implements AIProvider {
  readonly name = 'fake' as const;
  readonly sendsDataExternally = false;
  readonly label = 'Lecture par règles (sans IA)';

  /**
   * The rules' own order, cut to the limit, and no sentence at all: there is
   * no model here to have an opinion on why a story is worth reading.
   */
  async chooseStories(request: StorySelectionRequest): Promise<StorySelectionResult> {
    assertSelectable(request);
    return validateStorySelection(
      {
        selections: request.candidates
          .slice(0, request.limit)
          .map((candidate) => ({ candidateId: candidate.id, angle: '' })),
      },
      request,
      { provider: 'fake', model: 'rules-fr-1', version: STORY_SELECTION_VERSION },
    );
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    assertExtractable(request);
    const text = request.text;
    const subject = request.subjectHint?.trim() || 'la personne concernée';
    const facts: ExtractionOutput['facts'] = [];
    const caveats: string[] = [];

    // --- Birth -----------------------------------------------------------
    const birth = new RegExp(`\\bn[ée]e?\\s+(?:le\\s+)?${DATE_PATTERN}`, 'iu').exec(text);
    if (birth) {
      facts.push({
        predicate: 'BIRTH_DATE',
        subjectName: subject,
        valueText: `${birth[1]} ${birth[2]} ${birth[3]}`,
        normalised: toGedcom(birth[1] ?? '', birth[2] ?? '', birth[3] ?? ''),
        evidence: birth[0],
        confidence: 0.6,
      });
    }

    const birthPlace = new RegExp(
      `\\bn[ée]e?\\s+(?:le\\s+${DATE_PATTERN}\\s+)?[àa]\\s+(${NAME})`,
      'u',
    ).exec(text);
    if (birthPlace) {
      const place = birthPlace[birthPlace.length - 1] ?? '';
      facts.push({
        predicate: 'BIRTH_PLACE',
        subjectName: subject,
        valueText: place,
        normalised: null,
        evidence: birthPlace[0],
        confidence: 0.5,
      });
    }

    // --- Parents, and the sex the record states --------------------------
    const parents = new RegExp(
      `\\b(fils|fille)\\s+(?:l[ée]gitime\\s+)?de\\s+(${NAME})(?:,[^,;]*?)?\\s+et\\s+de\\s+(${NAME})`,
      'u',
    ).exec(text);
    if (parents) {
      const [evidence, kin, father, mother] = parents;
      facts.push({
        predicate: 'RECORDED_SEX',
        subjectName: subject,
        valueText: kin ?? '',
        normalised: kin?.toLowerCase() === 'fils' ? 'MALE' : 'FEMALE',
        evidence: evidence ?? '',
        confidence: 0.6,
      });
      for (const parent of [father, mother]) {
        if (!parent) continue;
        facts.push({
          predicate: 'PARENT',
          subjectName: subject,
          valueText: parent,
          normalised: null,
          evidence: evidence ?? '',
          confidence: 0.55,
        });
      }
    }

    // --- Death -----------------------------------------------------------
    const death = new RegExp(`\\bd[ée]c[ée]d[ée]e?\\s+(?:le\\s+)?${DATE_PATTERN}`, 'iu').exec(text);
    if (death) {
      facts.push({
        predicate: 'DEATH_DATE',
        subjectName: subject,
        valueText: `${death[1]} ${death[2]} ${death[3]}`,
        normalised: toGedcom(death[1] ?? '', death[2] ?? '', death[3] ?? ''),
        evidence: death[0],
        confidence: 0.6,
      });
    }

    // --- Occupations of whoever is named with one ------------------------
    const occupation = new RegExp(`(${NAME}),\\s+(${OCCUPATIONS})\\b`, 'gu');
    for (const match of text.matchAll(occupation)) {
      const [evidence, name, trade] = match;
      if (!name || !trade) continue;
      facts.push({
        predicate: 'OCCUPATION',
        subjectName: name,
        valueText: trade,
        normalised: null,
        evidence: evidence ?? '',
        confidence: 0.5,
      });
    }

    if (facts.length === 0) {
      caveats.push(
        'Aucune formule reconnue. La lecture par règles ne connaît que quelques tournures d’état civil ; un modèle lirait davantage.',
      );
    }
    caveats.push(
      'Lecture par expressions régulières : dates en chiffres seulement, aucun calendrier républicain.',
    );

    return verifyExtraction(
      { documentKind: birth ? 'BIRTH_ACT' : death ? 'DEATH_ACT' : 'OTHER', facts, caveats },
      text,
      {
        provider: 'fake',
        model: 'rules-fr-1',
        promptVersion: PROMPT_VERSION,
        pipelineVersion: PIPELINE_VERSION,
      },
    );
  }
}
