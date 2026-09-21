'use client';

import { useActionState, useState } from 'react';
import { ofName } from '@/lib/french';
import { IDLE, type ActionState } from '@/server/action-state';
import { mergeDuplicateAction } from '@/server/duplicate-actions';

/**
 * Make two records one, keeping the one the reader points at.
 *
 * Deliberately not a single "merge" button: the question is never whether to
 * merge but which record survives, and that answer decides which identifier
 * the rest of the world keeps citing.
 *
 * And deliberately in two steps, like retiring a person by hand: the two
 * buttons sit side by side, they differ by one name, and the mistake they
 * invite cannot be undone from the interface. The second step says which
 * record is about to leave the tree before anything happens.
 */
export function DuplicateMergeButton({
  treeSlug,
  keepId,
  mergeId,
  keptName,
  mergedName,
  label,
}: {
  treeSlug: string;
  keepId: string;
  mergeId: string;
  keptName: string;
  mergedName: string;
  label: string;
}) {
  // On success the action redirects to the record that survived; only a
  // refusal comes back here.
  const [state, action, pending] = useActionState<ActionState, FormData>(
    mergeDuplicateAction,
    IDLE,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium"
      >
        {label}
      </button>
    );
  }

  return (
    <form
      action={action}
      className="border-border-default bg-surface-1 flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
    >
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <input type="hidden" name="keepId" value={keepId} />
      <input type="hidden" name="mergeId" value={mergeId} />

      {/* The record is the subject, not the person: "X sera retirée" reads as
          though someone were being removed from the family. */}
      <p className="text-text-secondary max-w-prose text-sm">
        La fiche <span className="text-text-primary font-medium">{ofName(mergedName)}</span> sera
        retirée de l’arbre. Ses noms, ses événements, ses liens et ses sources passent sur{' '}
        <span className="text-text-primary font-medium">{keptName}</span>, qui garde son adresse.
      </p>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {pending ? 'Fusion…' : 'Fusionner les deux fiches'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-muted hover:text-text-primary text-sm"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
