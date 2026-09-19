import { describe, expect, it, vi } from 'vitest';
import { chooseStoriesWithClaude, type ExtractionClient } from './anthropic-provider';
import { FakeAIProvider } from './fake-provider';
import { ExtractionError } from './provider';
import {
  STORY_SELECTION_SYSTEM_PROMPT,
  validateStorySelection,
  type StorySelectionOutput,
  type StorySelectionRequest,
} from './story-selection';

/**
 * Choosing stories, and nothing more.
 *
 * The model picks among candidates the rules found and may add one sentence
 * each; everything here checks that it cannot do more than that — no
 * candidate it made up, none twice, none beyond the limit, and no sentence
 * that brings in a number the candidate does not contain. No test calls the
 * API: the client is a stub.
 */

const REQUEST: StorySelectionRequest = {
  limit: 2,
  candidates: [
    {
      id: 'migration:ricardo:gustave',
      kind: 'migration',
      title: 'De Tours à Buenos Aires',
      reason: '10 950 km entre la naissance de Gustave CHASSAGNE et celle de Ricardo CHASSAGNE.',
    },
    {
      id: 'deep-line:emile',
      kind: 'deep-line',
      title: 'La lignée la plus ancienne',
      reason: '6 générations depuis Émile MOREAU, jusqu’en 1702.',
    },
    {
      id: 'well-documented:pierre',
      kind: 'well-documented',
      title: 'Une vie bien documentée',
      reason: 'Pierre CHASSAGNE : 3 événements sourcés sur 3.',
    },
  ],
};

const META = { provider: 'anthropic' as const, model: 'claude-opus-5', version: 'test' };

describe('what a selection may contain', () => {
  it('keeps real candidates, in the order chosen', () => {
    const result = validateStorySelection(
      {
        selections: [
          { candidateId: 'deep-line:emile', angle: 'Six générations, jusqu’en 1702.' },
          {
            candidateId: 'migration:ricardo:gustave',
            angle: 'Une famille qui traverse l’océan : 10 950 km.',
          },
        ],
      },
      REQUEST,
      META,
    );
    expect(result.selections.map((selection) => selection.candidateId)).toEqual([
      'deep-line:emile',
      'migration:ricardo:gustave',
    ]);
    expect(result.droppedAngles).toBe(0);
  });

  it('drops a candidate it made up, one it chose twice, and any beyond the limit', () => {
    const result = validateStorySelection(
      {
        selections: [
          { candidateId: 'invented:someone', angle: 'Une belle histoire.' },
          { candidateId: 'deep-line:emile', angle: '' },
          { candidateId: 'deep-line:emile', angle: '' },
          { candidateId: 'migration:ricardo:gustave', angle: '' },
          { candidateId: 'well-documented:pierre', angle: '' },
        ],
      },
      REQUEST,
      META,
    );
    expect(result.selections.map((selection) => selection.candidateId)).toEqual([
      'deep-line:emile',
      'migration:ricardo:gustave',
    ]);
    expect(result.discarded).toBe(3);
  });

  it('drops a sentence that states a year the candidate does not', () => {
    const result = validateStorySelection(
      {
        selections: [
          {
            candidateId: 'migration:ricardo:gustave',
            angle: 'Partis en 1889, ils ne revinrent jamais.',
          },
        ],
      },
      REQUEST,
      META,
    );
    expect(result.selections).toEqual([{ candidateId: 'migration:ricardo:gustave', angle: null }]);
    expect(result.droppedAngles).toBe(1);
  });

  it('reads a number with French spacing as the number it is', () => {
    const result = validateStorySelection(
      {
        selections: [
          {
            candidateId: 'migration:ricardo:gustave',
            angle: 'Près de 10 950 km séparent deux naissances.',
          },
        ],
      },
      REQUEST,
      META,
    );
    expect(result.selections[0]?.angle).toBe('Près de 10 950 km séparent deux naissances.');
  });
});

describe('without a model', () => {
  it('keeps the rules’ order and writes no sentence', async () => {
    const result = await new FakeAIProvider().chooseStories(REQUEST);
    expect(result.provider).toBe('fake');
    expect(result.selections).toEqual([
      { candidateId: 'migration:ricardo:gustave', angle: null },
      { candidateId: 'deep-line:emile', angle: null },
    ]);
  });

  it('refuses to choose from nothing', async () => {
    await expect(
      new FakeAIProvider().chooseStories({ limit: 3, candidates: [] }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('with Claude, the network replaced', () => {
  type ParseArguments = Parameters<ExtractionClient['beta']['messages']['parse']>;

  function stub(parsed: StorySelectionOutput | null, extra: Record<string, unknown> = {}) {
    const parse = vi.fn(async (..._args: ParseArguments) => ({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      stop_details: null,
      parsed_output: parsed,
      usage: { input_tokens: 400, output_tokens: 80 },
      ...extra,
    }));
    return { client: { beta: { messages: { parse } } } as unknown as ExtractionClient, parse };
  }

  it('asks the primary model, at low effort, for a constrained answer', async () => {
    const { client, parse } = stub({ selections: [] });
    await chooseStoriesWithClaude(client, 'claude-opus-5', REQUEST);
    const [params] = parse.mock.calls[0] ?? [];
    expect(params?.model).toBe('claude-opus-5');
    expect(params?.system).toBe(STORY_SELECTION_SYSTEM_PROMPT);
    expect(params?.output_config?.effort).toBe('low');
    expect(params?.output_config?.format).toBeDefined();
    expect(params?.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params?.fallbacks).toBe('default');
    // Every candidate goes in with its id, and nothing else about the family.
    const content = params?.messages[0]?.content;
    expect(typeof content === 'string' && content).toContain('id="deep-line:emile"');
  });

  it('holds the model’s answer to the same checks', async () => {
    const { client } = stub({
      selections: [
        { candidateId: 'made-up', angle: 'x' },
        { candidateId: 'deep-line:emile', angle: 'Jusqu’en 1650 !' },
      ],
    });
    const result = await chooseStoriesWithClaude(client, 'claude-opus-5', REQUEST);
    expect(result.selections).toEqual([{ candidateId: 'deep-line:emile', angle: null }]);
    expect(result).toMatchObject({ discarded: 1, droppedAngles: 1, provider: 'anthropic' });
  });

  it('reports a refusal and a truncated answer instead of a partial choice', async () => {
    await expect(
      chooseStoriesWithClaude(
        stub(null, { stop_reason: 'refusal', stop_details: { category: null } }).client,
        'claude-opus-5',
        REQUEST,
      ),
    ).rejects.toMatchObject({ code: 'REFUSED' });
    await expect(
      chooseStoriesWithClaude(
        stub({ selections: [] }, { stop_reason: 'max_tokens' }).client,
        'claude-opus-5',
        REQUEST,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });
});
