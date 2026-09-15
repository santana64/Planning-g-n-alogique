import type { FeatureFlags } from './schema';

/**
 * Configuration safe to ship to the browser.
 *
 * Deliberately hand-written rather than derived from the server env: a typo in
 * a spread operator must not be able to leak a secret into the client bundle.
 */
export interface PublicConfig {
  readonly appUrl: string;
  readonly mapStyleUrl: string;
  readonly features: FeatureFlags;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
