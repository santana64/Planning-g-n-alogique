'use server';

import { getTranslations } from 'next-intl/server';
import { getLocale } from 'next-intl/server';
import {
  TreeChangeRefused,
  markTreeDeleted,
  updateTreeSettings,
  type TreeVisibility,
} from '@chronolignee/db';
import { redirect } from '@/i18n/navigation';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ActionState } from './action-state';
import { authoriseWrite } from './authorise';
import { purgeTreeNow } from './purge';
import { revalidateDashboard, revalidateTree } from './revalidate';

const VISIBILITIES: readonly TreeVisibility[] = ['PRIVATE', 'LINK', 'PUBLIC'];

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

async function failure(error: unknown): Promise<ActionState> {
  const t = await getTranslations('actions');
  if (error instanceof TreeChangeRefused) {
    return { status: 'error', message: t(`tree.refusal.${error.code}`) };
  }
  logger.error(
    { event: 'tree.change_failed', error: error instanceof Error ? error.name : typeof error },
    'tree change failed',
  );
  return { status: 'error', message: t('tree.changeFailed') };
}

export async function updateTreeSettingsAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'manageTree');
  if ('error' in authorised) return authorised.error;

  const visibility = text(form, 'visibility') as TreeVisibility;
  if (!VISIBILITIES.includes(visibility)) {
    return { status: 'error', message: t('tree.chooseVisibility') };
  }

  try {
    await updateTreeSettings(
      db,
      {
        treeId: authorised.access.treeId,
        name: text(form, 'name'),
        description: text(form, 'description'),
        visibility,
        // An unchecked box sends nothing: absent means "do not hide".
        redactLivingPeople: form.get('redactLivingPeople') === 'on',
      },
      { userId: authorised.userId },
    );
  } catch (error) {
    return await failure(error);
  }
  revalidateTree(treeSlug);
  revalidateDashboard();
  return { status: 'success', message: t('tree.settingsSaved') };
}

export async function deleteTreeAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug, 'deleteTree');
  if ('error' in authorised) return authorised.error;

  try {
    await markTreeDeleted(
      db,
      { treeId: authorised.access.treeId, confirmation: text(form, 'confirmation') },
      { userId: authorised.userId },
    );
  } catch (error) {
    return await failure(error);
  }

  // Out of use already; the files and rows follow now, or by the sweeper.
  await purgeTreeNow(authorised.access.treeId);
  revalidateTree(treeSlug);
  revalidateDashboard();
  redirect({ href: '/app', locale: await getLocale() });
  // Not reached: redirect throws. Typed as returning, so said explicitly.
  return { status: 'success' };
}
