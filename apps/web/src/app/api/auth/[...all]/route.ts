import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

/**
 * Auth endpoints.
 *
 * Excluded from the locale middleware matcher: authentication is not a
 * localised page and must not be redirected through a locale prefix.
 */
export const { GET, POST } = toNextJsHandler(auth);

// Prisma's driver adapter and pg need Node, not the edge runtime.
export const runtime = 'nodejs';
