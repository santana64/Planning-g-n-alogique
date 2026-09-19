'use client';

import { useActionState, useState } from 'react';
import { IDLE, type ActionState } from '@/server/action-state';
import { deletePersonAction } from '@/server/person-actions';
import { SubmitButton } from './fields';

/**
 * Removing a person.
 *
 * Two deliberate frictions. The name must be typed, because "delete" next to
 * a list is how a researcher loses an ancestor they spent a winter finding;
 * and the wording says what actually happens — the record is withdrawn, not
 * destroyed, and the links that touched it go with it.
 *
 * The write is a soft delete. Nothing in this product hard-deletes genealogy:
 * the history of what a family believed about itself is research material.
 */
export function DeletePerson({
  treeSlug,
  personId,
  name,
}: {
  treeSlug: string;
  personId: string;
  name: string;
}) {
  // On success the action redirects to the list itself; only a refusal
  // comes back here.
  const [state, action, pending] = useActionState<ActionState, FormData>(deletePersonAction, IDLE);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-text-faint hover:text-danger self-start text-sm"
      >
        Retirer cette personne de l’arbre
      </button>
    );
  }

  return (
    <form
      action={action}
      className="border-danger/30 bg-danger/5 flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
    >
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <input type="hidden" name="personId" value={personId} />

      <p className="text-text-secondary text-sm">
        La fiche et tous ses liens seront retirés de l’arbre. Les révisions déjà enregistrées,
        elles, restent : elles disent ce que l’on croyait et quand.
      </p>

      <label htmlFor="confirm-name" className="text-text-secondary text-sm">
        Tapez <span className="text-text-primary font-medium">{name}</span> pour confirmer.
      </label>
      <input
        id="confirm-name"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        className="border-border-default bg-surface-1 text-text-primary focus:border-danger rounded-[var(--radius-md)] border px-3 py-2 focus:outline-none"
      />

      {state.status === 'error' && state.message ? (
        <p role="status" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton pending={pending} disabled={typed !== name} tone="danger">
          Retirer définitivement de l’arbre
        </SubmitButton>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped('');
          }}
          className="text-text-muted hover:text-text-primary text-sm"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
