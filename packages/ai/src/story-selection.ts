import { z } from 'zod';
import { ExtractionError } from './provider';

/**
 * Choosing which stories to tell.
 *
 * The candidates were found in the family's accepted records by deterministic
 * rules; each is a story the application can already tell, word for word,
 * from the record. The model is only asked which of them to present and in
 * what order, and for one short sentence on why each is worth reading. It
 * writes no part of any story.
 *
 * That sentence is still machine-written text shown beside a family's
 * history, so it is held to what the candidate itself says. A number in it —
 * a year, a distance, a count — must appear in the candidate's own title or
 * reason; a sentence that brings in a date nobody recorded is dropped rather
 * than shown. It is also labelled as the model's wherever it appears.
 */

export const STORY_SELECTION_VERSION = 'story-select-1';

export interface StoryCandidateSummary {
  readonly id: string;
  /** migration, deep-line, well-documented, four-generations. */
  readonly kind: string;
  readonly title: string;
  readonly reason: string;
}

export interface StorySelectionRequest {
  readonly candidates: readonly StoryCandidateSummary[];
  readonly limit: number;
}

export interface StorySelection {
  readonly candidateId: string;
  /** One sentence on why it is worth reading, or null when none survived the checks. */
  readonly angle: string | null;
}

export interface StorySelectionResult {
  readonly selections: readonly StorySelection[];
  readonly provider: 'anthropic' | 'fake';
  readonly model: string;
  readonly version: string;
  /** Selections dropped for naming an unknown or repeated candidate. */
  readonly discarded: number;
  /** Sentences dropped for stating a number the candidate does not contain. */
  readonly droppedAngles: number;
}

export const storySelectionOutputSchema = z.object({
  selections: z
    .array(
      z.object({
        candidateId: z.string(),
        angle: z.string(),
      }),
    )
    .max(20),
});

export type StorySelectionOutput = z.infer<typeof storySelectionOutputSchema>;

export const MAX_ANGLE_LENGTH = 220;

export const STORY_SELECTION_SYSTEM_PROMPT = `You help present a family history to the people researching it.

The user message lists candidate stories. Each was found in the family's own accepted records by deterministic rules, and the application can already tell each one from those records. Choose the ones that make the most interesting and varied set, in the order they should be presented, up to the limit given.

For each chosen candidate, write one sentence in French, at most thirty words, saying why it is worth reading. Use only what its title and reason say: do not add any name, date, place, number or fact that is not in that candidate. Do not speculate about feelings, motives or causes.

Only use candidate ids exactly as listed. Choosing fewer than the limit is fine when fewer are worth telling.`;

export function storySelectionUserText(request: StorySelectionRequest): string {
  const lines = request.candidates.map(
    (candidate) =>
      `<candidate id="${candidate.id}" kind="${candidate.kind}">\n<title>${candidate.title}</title>\n<reason>${candidate.reason}</reason>\n</candidate>`,
  );
  return `Limit: ${request.limit}\n\n${lines.join('\n')}`;
}

// JavaScript's \s already covers the no-break spaces French puts in "10 950".
const NUMBER = /\d[\d\s]*\d|\d/g;

function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((value) => value.replace(/\s/g, ''));
}

/**
 * Keep what refers to real candidates, once each, up to the limit; keep a
 * sentence only if every number in it comes from its candidate.
 */
export function validateStorySelection(
  output: StorySelectionOutput,
  request: StorySelectionRequest,
  meta: Pick<StorySelectionResult, 'provider' | 'model' | 'version'>,
): StorySelectionResult {
  const byId = new Map(request.candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const selections: StorySelection[] = [];
  let discarded = 0;
  let droppedAngles = 0;

  for (const selection of output.selections) {
    const candidate = byId.get(selection.candidateId);
    if (!candidate || seen.has(selection.candidateId) || selections.length >= request.limit) {
      discarded += 1;
      continue;
    }
    seen.add(selection.candidateId);

    // Line breaks and runs of ordinary spaces fold to one; the no-break
    // spaces French typography puts in "10 950 km" or before ":" stay.
    let angle: string | null = selection.angle.trim().replace(/[ \t\r\n]+/g, ' ');
    const allowed = new Set(numbersIn(`${candidate.title} ${candidate.reason}`));
    const invented = numbersIn(angle).some((number) => !allowed.has(number));
    if (angle.length === 0) {
      angle = null;
    } else if (invented || angle.length > MAX_ANGLE_LENGTH) {
      angle = null;
      droppedAngles += 1;
    }
    selections.push({ candidateId: candidate.id, angle });
  }

  return { ...meta, selections, discarded, droppedAngles };
}

export function assertSelectable(request: StorySelectionRequest): void {
  if (request.candidates.length === 0 || request.limit < 1) {
    throw new ExtractionError('EMPTY', 'no candidate to choose from');
  }
}
