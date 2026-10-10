'use server';

import { getLocale, getTranslations } from 'next-intl/server';
import { isUuid } from '@/lib/ids';
import { kinshipLabel, kinshipThrough } from '@/lib/kinship-messages';
import { loadKinship } from './ancestry';

/**
 * How two people are related, asked from a record.
 *
 * A read, not a write — but a Server Action is a public endpoint, so it
 * answers only through `loadKinship`, which resolves the reader's access to
 * the tree and refuses anyone they may not see. A refusal and a person who
 * does not exist read the same.
 */

export type KinshipState =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'success';
      readonly otherName: string;
      readonly label: string;
      readonly through: string;
    };

export async function kinshipAction(
  _previous: KinshipState,
  form: FormData,
): Promise<KinshipState> {
  const t = await getTranslations('person.kinship');
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const treeSlug = field('treeSlug');
  const subjectId = field('subjectId');
  const otherId = field('otherId');
  if (!otherId) return { status: 'error', message: t('choose') };
  if (!isUuid(subjectId) || !isUuid(otherId)) return { status: 'error', message: t('notFound') };

  const view = await loadKinship(treeSlug, subjectId, otherId);
  if (!view) return { status: 'error', message: t('notFound') };

  const locale = await getLocale();
  return {
    status: 'success',
    otherName: view.otherName,
    label: kinshipLabel(view.kinship, view.otherSex, locale),
    through: kinshipThrough(view.throughNames, locale),
  };
}
