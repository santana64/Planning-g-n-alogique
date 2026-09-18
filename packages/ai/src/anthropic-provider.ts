import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EXTRACTION_SYSTEM_PROMPT, PROMPT_VERSION } from './prompt';
import {
  PIPELINE_VERSION,
  extractionOutputSchema,
  verifyExtraction,
  type ExtractionResult,
} from './extraction';
import {
  ExtractionError,
  assertExtractable,
  type AIProvider,
  type ExtractionRequest,
} from './provider';

/**
 * Extraction by Claude.
 *
 * One request per transcription, with the output constrained to the
 * extraction schema by the API rather than coaxed into it by instructions.
 * What comes back still goes through the same evidence check as everything
 * else: a structured answer is a well-formed answer, not a true one.
 *
 * Nothing here logs the transcription or the response. Both are private —
 * a register entry names people, often living ones — and the only things
 * worth recording about a call are its model, its cost and whether it worked.
 */

/**
 * The part of the client this provider uses.
 *
 * Narrowed so a test can hand in a stub without a network, and so nothing
 * else on the client is reachable from here by accident.
 */
export type ExtractionClient = Pick<Anthropic, 'beta'>;

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Milliseconds, per request. The SDK retries on top of this. */
  readonly timeoutMs: number;
  readonly maxRetries?: number;
  /** Injected in tests. Built from the options otherwise. */
  readonly client?: ExtractionClient;
}

/**
 * Server-side refusal fallback.
 *
 * If the primary model declines a request on policy grounds, the API re-runs
 * it on a fallback chosen by refusal category instead of simply stopping. A
 * register entry is about as benign as input gets, so this should almost
 * never matter — which is exactly when a silent failure would go unnoticed.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Enough room for adaptive thinking plus a long act's worth of statements,
 * while staying under the SDK's non-streaming timeout ceiling.
 */
const MAX_OUTPUT_TOKENS = 16_000;

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  readonly sendsDataExternally = true;
  readonly label: string;

  private readonly client: ExtractionClient;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.label = `Claude (${options.model})`;
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        timeout: options.timeoutMs,
        maxRetries: options.maxRetries ?? 2,
      });
  }

  async extract(request: ExtractionRequest, signal?: AbortSignal): Promise<ExtractionResult> {
    assertExtractable(request);

    const hint = request.subjectHint?.trim();
    const userText = hint
      ? `The researcher opened this from the record of ${hint}. Statements about that person should name them as the record does.\n\n<transcription>\n${request.text}\n</transcription>`
      : `<transcription>\n${request.text}\n</transcription>`;

    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userText }],
          output_config: {
            format: betaZodOutputFormat(extractionOutputSchema),
            // Reading a clerk's hand and deciding which of four named people a
            // statement belongs to is the kind of work that repays thinking.
            effort: 'high',
          },
        },
        signal ? { signal } : undefined,
      );
    } catch (error) {
      throw toExtractionError(error);
    }

    // Checked before the content: a refusal arrives as an ordinary 200.
    if (response.stop_reason === 'refusal') {
      throw new ExtractionError('REFUSED', response.stop_details?.category ?? undefined);
    }
    if (response.stop_reason === 'max_tokens') {
      // A truncated structured answer may still parse as a shorter list —
      // which would present a partial reading as a complete one.
      throw new ExtractionError('INVALID_OUTPUT', 'truncated');
    }

    const parsed = response.parsed_output;
    if (!parsed) throw new ExtractionError('INVALID_OUTPUT', 'unparseable');

    return verifyExtraction(parsed, request.text, {
      provider: 'anthropic',
      // The model that actually answered, which a fallback can change.
      model: response.model,
      promptVersion: PROMPT_VERSION,
      pipelineVersion: PIPELINE_VERSION,
    });
  }
}

/**
 * The SDK's errors, reduced to what the application needs to decide.
 *
 * Most specific first: a timeout is a connection error, and every one of
 * these is an APIError, so the order is the logic. The original message is
 * never carried over — it can quote the request.
 */
export function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new ExtractionError('ABORTED');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ExtractionError('TIMEOUT');
  if (error instanceof Anthropic.APIConnectionError) return new ExtractionError('UNAVAILABLE');
  if (error instanceof Anthropic.RateLimitError) return new ExtractionError('RATE_LIMITED');
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError
  ) {
    // A bad key, a key without access, or a model name that does not exist:
    // all three are the operator's to fix, not the user's to retry.
    return new ExtractionError('MISCONFIGURED');
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return new ExtractionError('REJECTED_REQUEST');
  }
  if (error instanceof Anthropic.InternalServerError) return new ExtractionError('UNAVAILABLE');
  if (error instanceof Anthropic.APIError)
    return new ExtractionError('UNAVAILABLE', String(error.status ?? ''));
  return new ExtractionError('UNAVAILABLE');
}
