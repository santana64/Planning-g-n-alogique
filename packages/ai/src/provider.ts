import type { ExtractionResult } from './extraction';
import type { StorySelectionRequest, StorySelectionResult } from './story-selection';

/**
 * The provider boundary.
 *
 * Everything that reads a transcription goes through this interface, so the
 * rest of the application never knows which one it is talking to — and so a
 * test, a CI run or a family instance without an API key can use a provider
 * that sends nothing anywhere.
 */

export interface ExtractionRequest {
  /** The verbatim transcription to read. */
  readonly text: string;
  /**
   * The person the researcher is working on, as a hint for attributing
   * statements. A register names several people; knowing whose page this came
   * from resolves most of them.
   */
  readonly subjectHint?: string | undefined;
}

export interface AIProvider {
  readonly name: 'anthropic' | 'fake';
  /**
   * Whether the text leaves this server.
   *
   * Surfaced to the user before they send anything. A transcription routinely
   * names living people, and whether it goes to a third party is something
   * the person pressing the button is entitled to know in advance.
   */
  readonly sendsDataExternally: boolean;
  /** Human-readable, for the review screen: which reader produced a proposal. */
  readonly label: string;
  extract(request: ExtractionRequest, signal?: AbortSignal): Promise<ExtractionResult>;
  /**
   * Choose which of the given stories to present, in order. The stories
   * themselves are never written by the provider; see story-selection.ts.
   */
  chooseStories(
    request: StorySelectionRequest,
    signal?: AbortSignal,
  ): Promise<StorySelectionResult>;
}

export type ExtractionErrorCode =
  | 'NOT_CONFIGURED'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'REFUSED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'REJECTED_REQUEST'
  | 'MISCONFIGURED'
  | 'INVALID_OUTPUT'
  | 'ABORTED';

/**
 * A failed extraction, by kind.
 *
 * Carries a code and never the payload: the transcription and whatever the
 * model said about it are private, and an error object is exactly the thing
 * that ends up in a log aggregator.
 */
export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

/**
 * The longest transcription accepted in one request.
 *
 * A register entry is a few hundred characters and a full page a few
 * thousand. Forty thousand leaves room for a long notarial act without letting
 * someone paste a book — which would be slow, costly, and better split into
 * the records it actually contains.
 */
export const MAX_TRANSCRIPTION_CHARS = 40_000;

export function assertExtractable(request: ExtractionRequest): void {
  const length = request.text.trim().length;
  if (length === 0) throw new ExtractionError('EMPTY');
  if (length > MAX_TRANSCRIPTION_CHARS) {
    throw new ExtractionError('TOO_LONG', `${length} characters`);
  }
}
