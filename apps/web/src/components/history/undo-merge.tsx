'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import { undoMergeAction } from '@/server/duplicate-actions';

/**
 * Undoing a merge, from the history line that records it.
 *
 * Two steps, because it moves rows between two people: the first click says
 * what will happen, the second does it. Either answer is a real button.
 */
export function UndoMerge({ treeSlug, revisionId }: { treeSlug: string; revisionId: string }) {
  const t = useTranslations('history');
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(undoMergeAction, IDLE);

  // The page is refreshed after the confirmation has been read, not at once:
  // the refresh removes this line's button, and the message with it.
  useEffect(() => {
    if (state.status !== 'success') return;
    const timer = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(timer);
  }, [state, router]);

  if (state.status === 'success') {
    return (
      <p role="status" className="text-success text-xs">
        {state.message}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {asking ? (
        <form action={action} className="timeline-panel flex flex-wrap items-center gap-2">
          <input type="hidden" name="treeSlug" value={treeSlug} />
          <input type="hidden" name="revisionId" value={revisionId} />
          <span className="text-text-muted">{t('undoMergeHint')}</span>
          <button
            type="submit"
            disabled={pending}
            className="border-warning/50 text-warning hover:bg-warning/10 rounded-[var(--radius-md)] border px-2 py-1 transition-colors duration-[var(--duration-fast)] disabled:opacity-60"
          >
            {t('undoMergeConfirm')}
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            className="text-text-muted hover:text-text-primary"
          >
            {t('undoMergeCancel')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="text-text-muted hover:text-warning underline underline-offset-2"
        >
          {t('undoMerge')}
        </button>
      )}
      {state.status === 'error' && state.message ? (
        <span role="status" className="text-danger">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
