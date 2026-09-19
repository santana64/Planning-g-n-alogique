'use client';

import { useActionState, useState } from 'react';
import { IDLE, type ActionState } from '@/server/action-state';
import { leaveTreeAction } from '@/server/sharing-actions';

/** Leaving, confirmed once: coming back takes a new invitation. */
export function LeaveTree({ treeSlug, treeName }: { treeSlug: string; treeName: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(leaveTreeAction, IDLE);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-text-muted hover:text-danger self-start text-sm"
      >
        Quitter cet arbre
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <p className="text-text-secondary text-sm">
        Vous n’aurez plus accès à « {treeName} ». Y revenir demandera une nouvelle invitation.
      </p>
      <span className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="text-danger border-danger/40 rounded-[var(--radius-md)] border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          Quitter l’arbre
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-text-muted text-sm hover:underline"
        >
          Rester
        </button>
      </span>
      {state.status === 'error' && state.message ? (
        <p role="status" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
