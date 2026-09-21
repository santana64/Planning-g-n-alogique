import type { DuplicateSignalView } from '@/server/duplicates';

/**
 * What a duplicate score is made of, in words.
 *
 * Neither server-only nor client-only: the list renders it in the browser and
 * the comparison page on the server, and a `'use client'` module cannot lend
 * a plain function to a server component. The wording itself comes from the
 * catalogue, so the caller passes its own translator.
 */

/** Above this a signal is reported as agreeing rather than merely measured. */
const AGREEMENT = 0.75;

export type SignalTranslator = (key: string) => string;

export function agreeingSignals(
  signals: readonly DuplicateSignalView[],
  name: SignalTranslator,
): string[] {
  return signals.filter((signal) => signal.value >= AGREEMENT).map((signal) => name(signal.name));
}
