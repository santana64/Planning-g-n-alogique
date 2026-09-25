'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import { deleteTreeAction } from '@/server/tree-settings-actions';

/**
 * The end of a tree.
 *
 * The button stays disabled until the tree's name is typed exactly — the
 * server checks it again — because a single click is too little between a
 * person and the loss of decades of research.
 */
export function DeleteTree({
  treeSlug,
  treeName,
  counts,
}: {
  treeSlug: string;
  treeName: string;
  counts: { readonly people: number; readonly documents: number; readonly members: number };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteTreeAction, IDLE);
  const t = useTranslations('settings');
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === treeName.trim();

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <p className="text-text-secondary text-sm">
        {t('deleteWarning', { people: counts.people, documents: counts.documents })}{' '}
        {counts.members > 1 ? `${t('othersLoseAccess', { count: counts.members - 1 })} ` : ''}
        {t('nothingRecovered')}
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="delete-confirmation" className="text-text-secondary text-sm font-medium">
          {t('typeToConfirm', { value: treeName })}
        </label>
        <input
          id="delete-confirmation"
          name="confirmation"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="border-border-default bg-surface-1 text-text-primary w-full max-w-md rounded-[var(--radius-md)] border px-3 py-2"
        />
      </div>
      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!matches || pending}
        className="text-danger border-danger/50 hover:bg-danger/10 self-start rounded-[var(--radius-md)] border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('deleteForGood')}
      </button>
    </form>
  );
}
