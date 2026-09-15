import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Locale negotiation.
 *
 * Next 16 renamed this file from middleware.ts to proxy.ts; the contract is
 * unchanged. next-intl still exports the factory under its original name.
 */
export default createMiddleware(routing);

export const config = {
  /**
   * Everything except API routes, Next internals and files with an extension.
   *
   * The literal has to live here: Next statically analyses this field at build
   * time and rejects an imported constant. Two ways it fails quietly, both
   * pinned by proxy.test.ts:
   *
   *  - A single backslash before the dot. In a JS string literal `\.` collapses
   *    to `.`, so the exclusion becomes "any path containing any character"
   *    instead of "any path containing a dot", and no page gets a locale.
   *  - Dropping the /api exclusion. A sign-in POST redirected to
   *    /fr/api/auth/... just 404s, and it looks like an auth bug.
   */
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
