import type { DuplicateSignalView } from '@/server/duplicates';

/**
 * What a duplicate score is made of, in words.
 *
 * Neither server-only nor client-only: the list renders it in the browser
 * and the comparison page on the server, and a `'use client'` module cannot
 * lend a plain function to a server component.
 */

const SIGNAL_LABELS: Record<string, string> = {
  surname: 'nom',
  given: 'prénom',
  birth: 'naissance',
  death: 'décès',
  parents: 'parents',
  partners: 'union',
  children: 'enfants',
  birthPlace: 'lieu de naissance',
};

/** Above this a signal is reported as agreeing rather than merely measured. */
const AGREEMENT = 0.75;

export function agreeingSignals(signals: readonly DuplicateSignalView[]): string[] {
  return signals
    .filter((signal) => signal.value >= AGREEMENT)
    .map((signal) => SIGNAL_LABELS[signal.name] ?? signal.name);
}

/** The same, as the sentence both screens put after the score. */
export function signalSentence(signals: readonly DuplicateSignalView[]): string {
  const agreeing = agreeingSignals(signals);
  if (agreeing.length === 0) return 'aucun signal net';
  return `concordent : ${agreeing.join(', ')}`;
}
