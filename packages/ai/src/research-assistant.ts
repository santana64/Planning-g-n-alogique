import { z } from 'zod';
import { ExtractionError } from './provider';

/**
 * The research assistant: questions worth asking next, never answers.
 *
 * It is given what the record holds about one person — each fact with an
 * identifier — and the gaps the rule-based plan already found, and it may
 * propose further leads. What keeps it honest is what is checked after:
 *
 *  - every lead names the facts it rests on, and those identifiers must be
 *    among the ones it was given; a lead resting on nothing is dropped;
 *  - a surname in capitals that appears nowhere in what it was given is a
 *    person it invented — the lead is dropped. The product writes surnames
 *    in capitals, and the prompt asks for the same, so an ancestor conjured
 *    out of a plausible name has nowhere to hide;
 *  - leads are phrased as questions and hypotheses; adopting one opens a
 *    research task a person edits, and nothing is ever written to the tree.
 *
 * What is dropped is counted and shown, like discarded extraction
 * statements.
 */

export const RESEARCH_PROMPT_VERSION = 'fr-research-1';

export interface ResearchFact {
  /** Opaque, short: "f1", "gap-birth". */
  readonly id: string;
  /** One line, as the record states it: "Naissance : 12 juin 1851, Tours (sourcée)". */
  readonly text: string;
}

export interface ResearchAssistRequest {
  readonly person: string;
  readonly facts: readonly ResearchFact[];
  /** Gaps and anomalies already found by rules, so the assistant goes beyond them. */
  readonly known: readonly ResearchFact[];
  readonly limit: number;
}

export const researchOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      question: z.string(),
      rationale: z.string(),
      whereToLook: z.string().nullable(),
      basis: z.array(z.string()),
    }),
  ),
  /** What the record is too thin to support, in plain words. */
  caveats: z.array(z.string()),
});
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export interface ResearchSuggestionOut {
  readonly question: string;
  readonly rationale: string;
  readonly whereToLook: string | null;
  readonly basis: readonly string[];
}

export interface ResearchAssistResult {
  readonly suggestions: readonly ResearchSuggestionOut[];
  readonly caveats: readonly string[];
  /** Leads dropped by the checks, and why, by count. */
  readonly dropped: { readonly noBasis: number; readonly inventedName: number };
  readonly provenance: {
    readonly provider: string;
    readonly model: string;
    readonly version: string;
  };
}

export const MAX_RESEARCH_FACTS = 120;

export function assertAssistable(request: ResearchAssistRequest): void {
  if (request.facts.length === 0) throw new ExtractionError('EMPTY');
  if (request.facts.length + request.known.length > MAX_RESEARCH_FACTS) {
    throw new ExtractionError('TOO_LONG', `${request.facts.length} facts`);
  }
}

/** Words written in capitals that are not names: archival abbreviations, numerals. */
const NOT_A_NAME = new Set([
  'AD',
  'AN',
  'BMS',
  'NMD',
  'EC',
  'GEDCOM',
  'CGF',
  'SHD',
  'ANOM',
  'INSEE',
  'BNF',
  'PDF',
]);
const ROMAN = /^[IVXLCDM]+$/;

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();

/** Surnames as the product writes them: two or more capital letters, hyphens allowed. */
function capitalisedNames(text: string): string[] {
  return [...text.matchAll(/\b\p{Lu}[\p{Lu}'’-]{1,}\b/gu)]
    .map((match) => match[0])
    .filter((word) => !NOT_A_NAME.has(fold(word)) && !ROMAN.test(word));
}

export function validateResearch(
  output: ResearchOutput,
  request: ResearchAssistRequest,
  provenance: ResearchAssistResult['provenance'],
): ResearchAssistResult {
  const ids = new Set([...request.facts, ...request.known].map((fact) => fact.id));
  const corpus = fold(
    [request.person, ...request.facts.map((f) => f.text), ...request.known.map((f) => f.text)].join(
      ' ',
    ),
  );

  const suggestions: ResearchSuggestionOut[] = [];
  const seen = new Set<string>();
  let noBasis = 0;
  let inventedName = 0;

  for (const raw of output.suggestions) {
    const question = raw.question.trim().slice(0, 300);
    const rationale = raw.rationale.trim().slice(0, 800);
    const whereToLook = raw.whereToLook?.trim().slice(0, 300) || null;
    const basis = [...new Set(raw.basis.map((id) => id.trim()))].filter((id) => ids.has(id));
    if (!question || basis.length === 0) {
      noBasis += 1;
      continue;
    }
    const names = capitalisedNames(`${question} ${rationale} ${whereToLook ?? ''}`);
    if (names.some((name) => !corpus.includes(fold(name)))) {
      inventedName += 1;
      continue;
    }
    const key = fold(question);
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ question, rationale, whereToLook, basis });
    if (suggestions.length >= request.limit) break;
  }

  return {
    suggestions,
    caveats: output.caveats
      .map((caveat) => caveat.trim())
      .filter(Boolean)
      .slice(0, 6),
    dropped: { noBasis, inventedName },
    provenance,
  };
}

export const RESEARCH_SYSTEM_PROMPT = `You help a genealogist decide what to look for next about one person, using French archives.

You are given what the family tree records about that person — each fact on one line with an identifier in brackets — and the gaps that rules have already found. Propose further research leads: questions to answer, and where an answer is likely to be found. You do not answer them, and nothing you write enters the tree; a researcher reads each lead and decides whether to open it as a task.

What makes a lead useful is that it is checkable and grounded:
- Every lead lists in "basis" the identifiers of the facts it rests on, exactly as given. A lead that rests on none of them is discarded.
- Never state or assume a relationship, a date, a place or a person that the facts do not contain. A hypothesis is phrased as a question ("Was he the Jean CHASSAGNE baptised at Azay in 1798?" only if that name is in the facts). Write surnames in capitals, as the facts do; a surname that does not appear in the facts makes the lead invalid.
- "whereToLook" names the kind of record and series in French archival terms — registres paroissiaux (BMS, before 1792), état civil (NMD, from 1792), tables décennales, recensements (nominative, every five years from 1836), registres matricules (men, from the class of about 1867), actes notariés, tables de successions, registres de catholicité — with the place and the period when the facts give them. Do not invent call numbers or archive addresses.
- Prefer leads that go beyond the gaps already listed; do not repeat them.
- If the record is too thin to suggest anything sound, return fewer leads and say why in "caveats".

Write the leads in French.`;

export function researchUserText(request: ResearchAssistRequest): string {
  const lines = [
    `Personne : ${request.person}`,
    '',
    'Faits enregistrés :',
    ...request.facts.map((fact) => `[${fact.id}] ${fact.text}`),
    '',
    'Déjà relevé par les règles :',
    ...(request.known.length > 0
      ? request.known.map((fact) => `[${fact.id}] ${fact.text}`)
      : ['(rien)']),
    '',
    `Proposez au plus ${request.limit} pistes.`,
  ];
  return lines.join('\n');
}
