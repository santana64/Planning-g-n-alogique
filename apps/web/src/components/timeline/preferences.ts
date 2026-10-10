'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { branchColorForKey } from '@chronolignee/ui';
import type { TimelineRow } from '@/server/timeline';
import type { TimelineColorMode } from './render-timeline';

/**
 * Small client preferences for the timeline, read as external stores.
 *
 * Both live outside React — the media query in the browser, the colour
 * reading in localStorage — so they are subscribed to rather than copied into
 * state from an effect, and the server renders the defaults.
 */

// --- Reduced motion ---------------------------------------------------------

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

// --- Colour reading ---------------------------------------------------------

const COLOR_MODE_KEY = 'chronolignee.timeline.colorMode';
const DEFAULT_MODE: TimelineColorMode = 'SEX';
const listeners = new Set<() => void>();
/** The choice made in this tab, which wins even when storage refused it. */
let chosenHere: TimelineColorMode | null = null;

function readColorMode(): TimelineColorMode {
  if (chosenHere) return chosenHere;
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_KEY);
    return stored === 'SEX' || stored === 'BRANCH' ? stored : DEFAULT_MODE;
  } catch {
    // Storage blocked (a private window, a strict policy): the default.
    return DEFAULT_MODE;
  }
}

function subscribeColorMode(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the reading updates this one too.
  const onStorage = () => {
    chosenHere = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useColorMode(): [TimelineColorMode, (mode: TimelineColorMode) => void] {
  const mode = useSyncExternalStore(subscribeColorMode, readColorMode, () => DEFAULT_MODE);
  const choose = useCallback((next: TimelineColorMode) => {
    chosenHere = next;
    try {
      window.localStorage.setItem(COLOR_MODE_KEY, next);
    } catch {
      // Storage unavailable: the choice lasts for this visit.
    }
    for (const listener of listeners) listener();
  }, []);
  return [mode, choose];
}

// --- Swatches for HTML ------------------------------------------------------

const SEX_SWATCH: Record<TimelineRow['sex'], string> = {
  FEMALE: 'var(--sex-female)',
  MALE: 'var(--sex-male)',
  OTHER: 'var(--sex-other)',
  UNKNOWN: 'var(--sex-unknown)',
};

/** The colour of a life for a DOM swatch, matching what the canvas draws. */
export function swatchFor(
  row: Pick<TimelineRow, 'sex' | 'branchKey'>,
  mode: TimelineColorMode,
): string {
  return mode === 'BRANCH' ? branchColorForKey(row.branchKey).base : SEX_SWATCH[row.sex];
}
