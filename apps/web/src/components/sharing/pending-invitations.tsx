'use client';

import { useActionState } from 'react';
import { IDLE, type ActionState } from '@/server/action-state';
import type { PendingInvitationView } from '@/server/sharing';
import { revokeInvitationAction } from '@/server/sharing-actions';
import { ROLE_NAMES } from './role-labels';

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

export function PendingInvitations({
  treeSlug,
  invitations,
}: {
  treeSlug: string;
  invitations: readonly PendingInvitationView[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    revokeInvitationAction,
    IDLE,
  );

  if (invitations.length === 0) {
    return <p className="text-text-faint text-sm">Aucune invitation en attente.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Invitations en attente" className="flex flex-col">
        {invitations.map((invitation) => (
          <li
            key={invitation.invitationId}
            className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-b-0"
          >
            <span className="flex flex-col">
              <span className="text-text-primary text-sm">{invitation.email}</span>
              <span className="text-text-faint text-xs">
                {ROLE_NAMES[invitation.role]} · par {invitation.invitedBy} · jusqu’au{' '}
                {DAY.format(new Date(invitation.expiresAt))}
              </span>
            </span>
            {invitation.revocable ? (
              <form action={action}>
                <input type="hidden" name="treeSlug" value={treeSlug} />
                <input type="hidden" name="invitationId" value={invitation.invitationId} />
                <button
                  type="submit"
                  disabled={pending}
                  aria-label={`Annuler l’invitation de ${invitation.email}`}
                  className="text-text-faint hover:text-danger text-sm disabled:opacity-60"
                >
                  Annuler
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {state.status === 'error' && state.message ? (
        <p role="status" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
