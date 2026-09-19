'use client';

import { useActionState, useState } from 'react';
import { eraseAccountAction } from '@/server/account-actions';
import { IDLE, type ActionState } from '@/server/action-state';

export function EraseAccount({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(eraseAccountAction, IDLE);
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="erase-email" className="text-text-secondary text-sm font-medium">
          Tapez « {email} » pour confirmer
        </label>
        <input
          id="erase-email"
          name="email"
          type="email"
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
        Supprimer définitivement mon compte
      </button>
    </form>
  );
}
