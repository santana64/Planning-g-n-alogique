import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider, toExtractionError, type ExtractionClient } from './anthropic-provider';
import { EXTRACTION_SYSTEM_PROMPT } from './prompt';
import { ExtractionError } from './provider';
import type { ExtractionOutput } from './extraction';

/**
 * The real provider, with the network replaced.
 *
 * Nothing here calls the API — the client is a stub — so this runs in CI at
 * no cost. What it pins down is everything the provider decides for itself:
 * the shape of the request, what it does with a refusal or a truncated
 * answer, how it reports a failure, and that it never trusts a structured
 * answer just because it is well formed.
 */

const TEXT = 'Est né le 12 juin 1822 à Tours, fils de Pierre Chassagne et de Marie Lefèvre.';

type ParseArguments = Parameters<ExtractionClient['beta']['messages']['parse']>;

function stubClient(response: Record<string, unknown>) {
  const parse = vi.fn(async (..._args: ParseArguments) => response);
  const client = { beta: { messages: { parse } } } as unknown as ExtractionClient;
  return { client, parse };
}

function failingClient(error: unknown) {
  const parse = vi.fn(async () => {
    throw error;
  });
  return { beta: { messages: { parse } } } as unknown as ExtractionClient;
}

function answer(parsed: ExtractionOutput | null, extra: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    stop_details: null,
    parsed_output: parsed,
    usage: { input_tokens: 900, output_tokens: 300 },
    ...extra,
  };
}

const GOOD: ExtractionOutput = {
  documentKind: 'BIRTH_ACT',
  facts: [
    {
      predicate: 'BIRTH_DATE',
      subjectName: 'Jean-Baptiste Chassagne',
      valueText: '12 juin 1822',
      normalised: '12 JUN 1822',
      evidence: 'né le 12 juin 1822',
      confidence: 0.92,
    },
  ],
  caveats: [],
};

function provider(client: ExtractionClient) {
  return new AnthropicProvider({
    apiKey: 'unused',
    model: 'claude-opus-5',
    timeoutMs: 1000,
    client,
  });
}

describe('the request', () => {
  it('sends the transcription, constrained to the extraction schema', async () => {
    const { client, parse } = stubClient(answer(GOOD));
    await provider(client).extract({ text: TEXT, subjectHint: 'Jean-Baptiste CHASSAGNE' });

    const [params] = parse.mock.calls[0] ?? [];
    expect(params?.model).toBe('claude-opus-5');
    expect(params?.system).toBe(EXTRACTION_SYSTEM_PROMPT);
    // The output is constrained by the API, not coaxed by instructions.
    expect(params?.output_config?.format).toBeDefined();
    expect(params?.output_config?.effort).toBe('high');
    const content = params?.messages[0]?.content;
    expect(typeof content === 'string' && content.includes(TEXT)).toBe(true);
    expect(typeof content === 'string' && content.includes('Jean-Baptiste CHASSAGNE')).toBe(true);
  });

  it('asks for the server-side refusal fallback', async () => {
    const { client, parse } = stubClient(answer(GOOD));
    await provider(client).extract({ text: TEXT });
    const [params] = parse.mock.calls[0] ?? [];
    expect(params?.betas).toContain('server-side-fallback-2026-07-01');
    expect(params?.fallbacks).toBe('default');
  });

  it('keeps the system prompt byte-identical between calls', async () => {
    // The stable prefix is what makes repeated extractions cacheable; a
    // timestamp or an id in it would silently make every call full price.
    const { client, parse } = stubClient(answer(GOOD));
    const p = provider(client);
    await p.extract({ text: TEXT });
    await p.extract({ text: 'Autre acte : né le 1er mars 1790 à Azay.' });
    expect(parse.mock.calls[0]?.[0].system).toBe(parse.mock.calls[1]?.[0].system);
  });
});

describe('the answer', () => {
  it('returns verified statements with the model that answered', async () => {
    const { client } = stubClient(answer(GOOD, { model: 'claude-opus-4-8' }));
    const result = await provider(client).extract({ text: TEXT });
    expect(result.facts).toHaveLength(1);
    // A fallback can change the model; the proposal records the real one.
    expect(result.provenance.model).toBe('claude-opus-4-8');
    expect(result.provenance.provider).toBe('anthropic');
  });

  it('drops a statement whose evidence is not in the transcription', async () => {
    const invented: ExtractionOutput = {
      ...GOOD,
      facts: [
        ...GOOD.facts,
        {
          predicate: 'DEATH_DATE',
          subjectName: 'Jean-Baptiste Chassagne',
          valueText: '3 mars 1889',
          normalised: '3 MAR 1889',
          evidence: 'décédé le 3 mars 1889',
          confidence: 0.99,
        },
      ],
    };
    const { client } = stubClient(answer(invented));
    const result = await provider(client).extract({ text: TEXT });
    // Well-formed is not the same as true.
    expect(result.facts.map((fact) => fact.predicate)).toEqual(['BIRTH_DATE']);
    expect(result.discarded).toBe(1);
  });

  it('reports a refusal as a refusal, not as an empty reading', async () => {
    const { client } = stubClient(
      answer(null, {
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'other' },
      }),
    );
    await expect(provider(client).extract({ text: TEXT })).rejects.toMatchObject({
      code: 'REFUSED',
    });
  });

  it('refuses a truncated answer rather than presenting it as complete', async () => {
    // A list cut off at max_tokens can still parse — as a shorter list.
    const { client } = stubClient(answer(GOOD, { stop_reason: 'max_tokens' }));
    await expect(provider(client).extract({ text: TEXT })).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });

  it('refuses an answer that did not parse', async () => {
    const { client } = stubClient(answer(null));
    await expect(provider(client).extract({ text: TEXT })).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });

  it('never calls the API for an empty transcription', async () => {
    const { client, parse } = stubClient(answer(GOOD));
    await expect(provider(client).extract({ text: '  ' })).rejects.toMatchObject({ code: 'EMPTY' });
    expect(parse).not.toHaveBeenCalled();
  });
});

/** An instance that passes `instanceof` without depending on the constructor's arguments. */
function instanceOf<T extends object>(ctor: abstract new (...args: never[]) => T): T {
  return Object.create(ctor.prototype) as T;
}

describe('failures', () => {
  it.each([
    [Anthropic.RateLimitError, 'RATE_LIMITED'],
    [Anthropic.AuthenticationError, 'MISCONFIGURED'],
    [Anthropic.PermissionDeniedError, 'MISCONFIGURED'],
    [Anthropic.NotFoundError, 'MISCONFIGURED'],
    [Anthropic.BadRequestError, 'REJECTED_REQUEST'],
    [Anthropic.InternalServerError, 'UNAVAILABLE'],
    [Anthropic.APIConnectionTimeoutError, 'TIMEOUT'],
    [Anthropic.APIConnectionError, 'UNAVAILABLE'],
    [Anthropic.APIUserAbortError, 'ABORTED'],
  ] as const)('%o becomes %s', (ctor, code) => {
    expect(toExtractionError(instanceOf(ctor as never)).code).toBe(code);
  });

  it('distinguishes a timeout from any other connection failure', () => {
    // A timeout is a connection error too; checking the general class first
    // would report every timeout as "unavailable".
    expect(toExtractionError(instanceOf(Anthropic.APIConnectionTimeoutError)).code).toBe('TIMEOUT');
  });

  it('never carries the request into the error it reports', async () => {
    const leaky = new Error(`upstream said: ${TEXT}`);
    const error = await provider(failingClient(leaky))
      .extract({ text: TEXT })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExtractionError);
    // The transcription names people. It does not belong in an error message
    // that will end up in a log.
    expect((error as Error).message).not.toContain('Chassagne');
    expect((error as Error).message).not.toContain('1822');
  });
});
