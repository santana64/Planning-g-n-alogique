import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { auth, type Session } from './auth';

/**
 * Server-side session access.
 *
 * Wrapped in React's `cache` so a page that checks authorisation in the layout,
 * again in the page and again in a nested component resolves the session once
 * per request rather than three times.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const requestHeaders = await headers();
  return auth.api.getSession({ headers: requestHeaders });
});

/**
 * Session or nothing.
 *
 * Returns null rather than redirecting, because the caller knows where an
 * unauthenticated visitor should go and this module does not. Every protected
 * mutation must call this server-side: hiding a button in the UI is not
 * authorisation.
 */
export async function requireSession(): Promise<Session | null> {
  return getSession();
}
