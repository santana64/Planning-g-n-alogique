/**
 * Which request paths go through locale negotiation.
 *
 * Kept apart from proxy.ts, which imports Next's middleware runtime and
 * therefore cannot be loaded in a plain Node test. This is a routing policy,
 * not middleware wiring, and it is worth testing on its own: both ways it can
 * be wrong fail quietly.
 *
 *  - A single backslash before the dot. In a JS string literal `\.` collapses
 *    to `.`, so the pattern would exclude "any path containing any character"
 *    rather than "any path containing a dot", and no page would get a locale.
 *  - Forgetting to exclude /api. A sign-in POST redirected to /fr/api/auth/...
 *    just 404s, and the failure looks like an auth bug rather than a routing
 *    one.
 */

/**
 * Everything except API routes, Next internals and files with an extension.
 * `String.raw` so the escape survives: the pattern needs a literal backslash
 * before the dot, and writing it as a normal string literal is exactly the
 * mistake described above.
 */
export const LOCALE_MATCHER = String.raw`/((?!api|_next|_vercel|.*\..*).*)`;

export const LOCALE_MATCHERS = [LOCALE_MATCHER] as const;
