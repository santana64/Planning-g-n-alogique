import 'server-only';
import { planAccountErasure, type AccountErasurePlan } from '@chronolignee/db';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';

/**
 * The account page's reads.
 *
 * Erasing an account needs a recent sign-in, not just a session: a laptop
 * left open, or a stolen cookie, must not be enough to erase someone's
 * research. A password check here would be a password oracle outside the
 * sign-in rate limit; asking to sign in again reuses the limit that exists.
 */

export const FRESH_SESSION_MS = 15 * 60 * 1000;

export interface AccountView {
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
  readonly freshSession: boolean;
  readonly plan: AccountErasurePlan;
}

export function isFresh(createdAt: Date | string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() < FRESH_SESSION_MS;
}

export async function loadAccount(): Promise<AccountView | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await db.user.findFirst({
    where: { id: session.user.id, deletedAt: null },
    select: { name: true, email: true, createdAt: true },
  });
  if (!user) return null;
  return {
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    freshSession: isFresh(session.session.createdAt),
    plan: await planAccountErasure(db, session.user.id),
  };
}
