'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import { dismissDuplicateAction } from '@/server/duplicate-actions';

/** Say the two records are two people. The pair is not proposed again. */
export function DuplicateDismissButton({
  treeSlug,
  candidateId,
  className,
}: {
  treeSlug: string;
  candidateId: string;
  className?: string;
}) {
  const t = useTranslations('duplicates');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    dismissDuplicateAction,
    IDLE,
  );

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <input type="hidden" name="candidateId" value={candidateId} />
      <button
        type="submit"
        disabled={pending}
        className={
          className ??
          'border-border-subtle text-text-muted hover:text-text-primary rounded-[var(--radius-md)] border px-4 py-2 text-sm disabled:opacity-60'
        }
      >
        {t('notTheSame')}
      </button>
      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
