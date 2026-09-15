import createMiddleware from 'next-intl/middleware';
import { LOCALE_MATCHERS } from './i18n/matcher';
import { routing } from './i18n/routing';

/**
 * Locale negotiation.
 *
 * Next 16 renamed this file from middleware.ts to proxy.ts; the contract is
 * unchanged. next-intl still exports the factory under its original name.
 *
 * The matcher lives in ./i18n/matcher so it can be tested without loading
 * Next's middleware runtime.
 */
export default createMiddleware(routing);

export const config = {
  matcher: LOCALE_MATCHERS,
};
