'use server';

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
  const session = await getSession();
  if (!session) {
    return { status: 'error', message: 'Connectez-vous pour créer un arbre.' };
  }

  const name = String(form.get('name') ?? '').trim();
  if (!name) {
    return {
      status: 'error',
      message: 'Donnez un nom à cet arbre.',
      fieldErrors: { name: 'Par exemple : Famille Chassagne.' },
    };
  }
  if (name.length > 120) {
    return { status: 'error', message: 'Ce nom est trop long.' };
  }

  try {
    const created = await createTree(db, { name }, session.user.id);
    revalidateDashboard();
    return { status: 'success', message: `« ${name} » a été créé.`, slug: created.slug };
  } catch {
    return { status: 'error', message: "L'arbre n'a pas pu être créé." };
  }
}
