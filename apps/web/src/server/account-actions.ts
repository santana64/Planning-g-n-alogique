'use server';

import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { AccountErasureBlocked, eraseAccount } from '@chronolignee/db';
import { redirect } from '@/i18n/navigation';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getSession } from '@/lib/session';
import { isFresh } from './account';
import type { ActionState } from './action-state';
import { purgeTreeNow } from './purge';
import { revalidateDashboard } from './revalidate';

/**
 * Erasing one's own account.
 *
 * Three conditions, all checked here whatever the page showed: a session, a
 * recent sign-in, and the account's address typed out. Then the account goes
 * in one transaction, the trees that went with it are purged, and the
 * browser's session cookies are cleared — the cached session in a cookie would
 * otherwise outlive the account for minutes.
 */
export async function eraseAccountAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const common = await getTranslations('common');
  const session = await getSession();
  if (!session) return { status: 'error', message: t('account.signIn') };
  if (!isFresh(session.session.createdAt)) {
    return {
      status: 'error',
      message: t('account.freshSession'),
    };
  }
  const typed = form.get('email');
  if (
    typeof typed !== 'string' ||
    typed.trim().toLowerCase() !== session.user.email.toLowerCase()
  ) {
    return {
      status: 'error',
      message: t('account.typeExactly'),
    };
  }

  let treesToPurge: readonly string[];
  try {
    ({ treesToPurge } = await eraseAccount(db, session.user.id));
  } catch (error) {
    if (error instanceof AccountErasureBlocked) {
      return {
        status: 'error',
        message: t('account.nameAnotherOwner', {
          trees: error.trees.map((tree) => common('quoted', { value: tree.name })).join(', '),
        }),
      };
    }
    logger.error(
      { event: 'account.erase_failed', error: error instanceof Error ? error.name : typeof error },
      'account erasure failed',
    );
    return { status: 'error', message: t('account.eraseFailed') };
  }

  for (const treeId of treesToPurge) await purgeTreeNow(treeId);
  // The account is gone; no identifier of it goes to the log either.
  logger.info({ event: 'account.erased', trees: treesToPurge.length }, 'account erased');

  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.includes('chronolignee.')) jar.delete(cookie.name);
  }
  revalidateDashboard();
  redirect({ href: '/', locale: await getLocale() });
  // Not reached: redirect throws. Typed as returning, so said explicitly.
  return { status: 'success' };
}
