import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing.
 *
 * French is the default and is served without a prefix, because the product is
 * French-first and its primary users should not read a URL that treats their
 * language as an option. Additional locales are additive: nothing in the
 * architecture assumes there are exactly two.
 */
export const routing = defineRouting({
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  localePrefix: 'as-needed',
});

export type AppLocale = (typeof routing.locales)[number];
