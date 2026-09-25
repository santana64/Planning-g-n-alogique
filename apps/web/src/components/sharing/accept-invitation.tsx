'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import { acceptInvitationAction } from '@/server/sharing-actions';

export function AcceptInvitation({ token, treeName }: { token: string; treeName: string }) {
  const t = useTranslations('sharing');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    acceptInvitationAction,
    IDLE,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-contrast hover:bg-accent-hover self-start rounded-[var(--radius-md)] px-5 py-2.5 font-medium disabled:opacity-60"
      >
        {t('join', { tree: treeName })}
      </button>
      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="text-danger border-danger/30 bg-danger/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
