'use server';

import { getTranslations } from 'next-intl/server';
import { createTree } from '@chronolignee/db';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import type { ActionState } from './action-state';
import { revalidateDashboard } from './revalidate';

/**
 * Creating a tree.
 *
 * The only mutation that needs no tree-level authorisation, because there is
 * no tree yet — a signed-in account may create one. Everything after this
 * point is guarded by membership.
 */
export async function createTreeAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState & { slug?: string }> {
  const t = await getTranslations('actions');
  const session = await getSession();
  if (!session) {
    return { status: 'error', message: t('tree.signIn') };
  }

  const name = String(form.get('name') ?? '').trim();
  if (!name) {
    return {
      status: 'error',
      message: t('tree.nameRequired'),
      fieldErrors: { name: t('tree.nameExample') },
    };
  }
  if (name.length > 120) {
    return { status: 'error', message: t('tree.nameTooLong') };
  }

  try {
    const created = await createTree(db, { name }, session.user.id);
    revalidateDashboard();
    return { status: 'success', message: t('tree.created', { name }), slug: created.slug };
  } catch {
    return { status: 'error', message: t('tree.createFailed') };
  }
}
