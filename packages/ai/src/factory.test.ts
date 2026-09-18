import { describe, expect, it } from 'vitest';
import { createAIProvider, detectCI } from './factory';
import { FakeAIProvider } from './fake-provider';
import { AnthropicProvider, type ExtractionClient } from './anthropic-provider';

/**
 * Choosing a provider — and the one refusal that must never be relaxed.
 */

const stub = { beta: { messages: { parse: async () => ({}) } } } as unknown as ExtractionClient;

const BASE = { model: 'claude-opus-5', timeoutMs: 1000, isCI: false } as const;

describe('choosing a provider', () => {
  it('returns nothing when AI is turned off', () => {
    // Null, not a provider that fails: a button that cannot work should not
    // be rendered at all.
    expect(createAIProvider({ ...BASE, provider: 'none' })).toBeNull();
  });

  it('returns the test double for fake', () => {
    expect(createAIProvider({ ...BASE, provider: 'fake' })).toBeInstanceOf(FakeAIProvider);
  });

  it('returns the real provider when configured outside CI', () => {
    const provider = createAIProvider({
      ...BASE,
      provider: 'anthropic',
      apiKey: 'k',
      client: stub,
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider?.sendsDataExternally).toBe(true);
  });

  it('refuses the real provider without a key', () => {
    expect(() => createAIProvider({ ...BASE, provider: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('continuous integration', () => {
  it('never builds the paid provider in CI, key or no key', () => {
    // The guard the whole configuration rests on. A CI run is automated,
    // repeated on every push, and reads whatever the fixtures contain.
    expect(() =>
      createAIProvider({ ...BASE, isCI: true, provider: 'anthropic', apiKey: 'a-real-key' }),
    ).toThrow(/refused in CI/);
  });

  it('still allows the test double in CI', () => {
    expect(createAIProvider({ ...BASE, isCI: true, provider: 'fake' })).toBeInstanceOf(
      FakeAIProvider,
    );
  });

  it.each([
    [{ CI: 'true' }, true],
    [{ CI: '1' }, true],
    [{ CI: 'yes' }, true],
    [{ CI: 'false' }, false],
    [{ CI: '0' }, false],
    [{ CI: '' }, false],
    [{}, false],
  ])('reads %o as CI=%s', (env, expected) => {
    expect(detectCI(env)).toBe(expected);
  });
});
