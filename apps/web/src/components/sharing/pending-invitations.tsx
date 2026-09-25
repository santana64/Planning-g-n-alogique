'use client';

import { useActionState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import type { PendingInvitationView } from '@/server/sharing';
import { revokeInvitationAction } from '@/server/sharing-actions';

export function PendingInvitations({
  treeSlug,
  invitations,
}: {
  treeSlug: string;
  invitations: readonly PendingInvitationView[];
}) {
  const t = useTranslations('sharing');
  const roles = useTranslations('tree.roles');
  const format = useFormatter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    revokeInvitationAction,
    IDLE,
  );

  if (invitations.length === 0) {
    return <p className="text-text-faint text-sm">{t('noPending')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t('pending')} className="flex flex-col">
        {invitations.map((invitation) => (
          <li
            key={invitation.invitationId}
            className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-b-0"
          >
            <span className="flex flex-col">
              <span className="text-text-primary text-sm">{invitation.email}</span>
              <span className="text-text-faint text-xs">
                {t('invitationLine', {
                  role: roles(invitation.role),
                  by: invitation.invitedBy,
                  until: format.dateTime(new Date(invitation.expiresAt), {
                    day: 'numeric',
                    month: 'long',
                  }),
                })}
              </span>
            </span>
            {invitation.revocable ? (
              <form action={action}>
                <input type="hidden" name="treeSlug" value={treeSlug} />
                <input type="hidden" name="invitationId" value={invitation.invitationId} />
                <button
                  type="submit"
                  disabled={pending}
                  aria-label={t('cancelInvitation', { email: invitation.email })}
                  className="text-text-faint hover:text-danger text-sm disabled:opacity-60"
                >
                  {t('cancel')}
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
