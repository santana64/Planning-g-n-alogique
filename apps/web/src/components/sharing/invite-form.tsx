'use client';

import { useActionState, useState } from 'react';
import type { TreeRole } from '@chronolignee/domain';
import { inviteMemberAction } from '@/server/sharing-actions';
import { IDLE_INVITE, type InviteState } from '@/server/sharing-state';
import { ROLE_DESCRIPTIONS, ROLE_NAMES } from './role-labels';

/**
 * Inviting someone.
 *
 * The link comes back once and is shown for copying. No e-mail is sent: the
 * instance has no mail provider unless one is configured, and a link in the
 * inviter's hands reaches a relative by whatever channel they already use.
 */
export function InviteForm({ treeSlug, roles }: { treeSlug: string; roles: readonly TreeRole[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(
    inviteMemberAction,
    IDLE_INVITE,
  );
  const [role, setRole] = useState<TreeRole>(
    roles.includes('VIEWER') ? 'VIEWER' : (roles[0] ?? 'VIEWER'),
  );
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
        <input type="hidden" name="treeSlug" value={treeSlug} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-text-secondary text-sm font-medium">
            Adresse e-mail
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            className="border-border-default bg-surface-1 text-text-primary w-full rounded-[var(--radius-md)] border px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-text-secondary text-sm font-medium">
            Rôle
          </label>
          <select
            id="invite-role"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value as TreeRole)}
            aria-describedby="invite-role-hint"
            className="border-border-default bg-surface-1 text-text-primary w-full rounded-[var(--radius-md)] border px-3 py-2"
          >
            {roles.map((value) => (
              <option key={value} value={value}>
                {ROLE_NAMES[value]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-accent-contrast hover:bg-accent-hover self-end rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          Créer le lien
        </button>
        <p id="invite-role-hint" className="text-text-faint text-xs sm:col-span-3">
          {ROLE_DESCRIPTIONS[role]} Le lien vaut pour cette adresse seulement, une fois, pendant
          sept jours.
        </p>
      </form>

      {state.status !== 'idle' && state.message ? (
        <div
          role="status"
          className={`flex flex-col gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
            state.status === 'error'
              ? 'text-danger border-danger/30 bg-danger/10'
              : 'text-success border-success/30 bg-success/10'
          }`}
        >
          <p>{state.message}</p>
          {state.link ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="invite-link" className="sr-only">
                Lien d’invitation
              </label>
              <input
                id="invite-link"
                readOnly
                value={state.link}
                onFocus={(event) => event.currentTarget.select()}
                className="border-border-default bg-surface-1 text-text-primary min-w-0 flex-1 rounded-[var(--radius-md)] border px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(state.link ?? '').then(() => setCopied(true));
                }}
                className="text-accent text-sm hover:underline"
              >
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
