import 'server-only';
import { createAIProvider, detectCI, type AIProvider } from '@chronolignee/ai';
import { env } from '@/lib/env';

/**
 * The configured reader, built once per server process.
 *
 * Null when AI is turned off. Every screen that offers extraction asks this
 * module first, so "AI is off" renders as the absence of a button rather
 * than as a button that fails.
 */

let cached: { provider: AIProvider | null } | null = null;

export function getAIProvider(): AIProvider | null {
  if (cached) return cached.provider;
  cached = {
    provider: createAIProvider({
      provider: env.AI_PROVIDER,
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL_PRIMARY,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      isCI: detectCI(process.env),
    }),
  };
  return cached.provider;
}

export interface AIStatus {
  readonly enabled: boolean;
  /** Which reader, in words a researcher can act on. */
  readonly label: string;
  /**
   * Whether text leaves this server.
   *
   * Shown before anyone presses the button. A transcription routinely names
   * living people, and where it goes is something the person sending it is
   * entitled to know first.
   */
  readonly sendsDataExternally: boolean;
}

export function getAIStatus(): AIStatus {
  const provider = getAIProvider();
  return provider
    ? { enabled: true, label: provider.label, sendsDataExternally: provider.sendsDataExternally }
    : { enabled: false, label: '', sendsDataExternally: false };
}
