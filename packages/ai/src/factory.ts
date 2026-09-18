import { AnthropicProvider, type ExtractionClient } from './anthropic-provider';
import { FakeAIProvider } from './fake-provider';
import { ExtractionError, type AIProvider } from './provider';

/**
 * Choosing a provider from configuration.
 *
 * Returns null when AI is turned off, rather than a provider that fails: the
 * application should not render a button that cannot work, and a null forces
 * every caller to decide what "no AI" looks like on its screen.
 */

export interface ProviderConfig {
  readonly provider: 'anthropic' | 'fake' | 'none';
  readonly apiKey?: string | undefined;
  readonly model: string;
  readonly timeoutMs: number;
  /**
   * Whether this process is running in continuous integration.
   *
   * Passed in rather than read from the environment here, so the refusal
   * below is testable — a guard nobody can exercise is a guard nobody knows
   * still works.
   */
  readonly isCI: boolean;
  /** Test seam for the real provider. */
  readonly client?: ExtractionClient;
}

export function createAIProvider(config: ProviderConfig): AIProvider | null {
  switch (config.provider) {
    case 'none':
      return null;

    case 'fake':
      return new FakeAIProvider();

    case 'anthropic': {
      // Continuous integration never calls a paid API. Not "should not": a CI
      // run is automated, repeated on every push, and reads whatever the
      // fixtures contain — the combination that turns a misconfigured secret
      // into an invoice. There is deliberately no override flag; changing this
      // is a code change someone has to review.
      if (config.isCI) {
        throw new ExtractionError('NOT_CONFIGURED', 'the paid provider is refused in CI');
      }
      if (!config.apiKey && !config.client) {
        throw new ExtractionError('MISCONFIGURED', 'ANTHROPIC_API_KEY is not set');
      }
      return new AnthropicProvider({
        apiKey: config.apiKey ?? '',
        model: config.model,
        timeoutMs: config.timeoutMs,
        ...(config.client ? { client: config.client } : {}),
      });
    }
  }
}

/** The usual reading of "am I in CI", shared so every caller agrees on it. */
export function detectCI(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env['CI'];
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}
