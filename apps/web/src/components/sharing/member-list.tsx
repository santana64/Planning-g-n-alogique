'use client';

import { useActionState } from 'react';
import type { TreeRole } from '@chronolignee/domain';
import { IDLE, type ActionState } from '@/server/action-state';
import type { MemberView } from '@/server/sharing';
import { changeRoleAction, removeMemberAction } from '@/server/sharing-actions';
import { ROLE_NAMES } from './role-labels';

/**
 * The members, and what this viewer may change about each.
 *
 * A role is changed with its own small form and button rather than on
 * select-change: a role decides what someone can erase, and a keyboard user
 * arrowing through a select must not re-role a cousin at every keystroke.
 */
export function MemberList({
  treeSlug,
  members,
}: {
  treeSlug: string;
  members: readonly MemberView[];
}) {
  const [roleState, roleAction, changing] = useActionState<ActionState, FormData>(
    changeRoleAction,
    IDLE,
  );
  const [removeState, removeAction, removing] = useActionState<ActionState, FormData>(
    removeMemberAction,
    IDLE,
  );
  const state = removeState.status !== 'idle' ? removeState : roleState;

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Membres" className="flex flex-col">
        {members.map((member) => (
          <li
            key={member.memberId}
            className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0"
          >
            <span className="flex flex-col">
              <span className="text-text-primary">
                {member.name}
                {member.isMe ? <span className="text-text-faint text-sm"> (vous)</span> : null}
              </span>
              {member.email ? (
                <span className="text-text-faint text-xs">{member.email}</span>
              ) : null}
            </span>

            <span className="flex flex-wrap items-center gap-3">
              {member.assignableRoles.length > 1 ? (
                <form action={roleAction} className="flex items-center gap-2">
                  <input type="hidden" name="treeSlug" value={treeSlug} />
                  <input type="hidden" name="memberId" value={member.memberId} />
                  <label className="sr-only" htmlFor={`role-${member.memberId}`}>
                    Rôle de {member.name}
                  </label>
                  <select
                    id={`role-${member.memberId}`}
                    name="role"
                    defaultValue={member.role}
                    className="border-border-default bg-surface-1 text-text-primary rounded-[var(--radius-md)] border px-2 py-1 text-sm"
                  >
                    {member.assignableRoles.map((role: TreeRole) => (
                      <option key={role} value={role}>
                        {ROLE_NAMES[role]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={changing}
                    className="text-accent text-sm hover:underline disabled:opacity-60"
                  >
                    Changer
                  </button>
                </form>
              ) : (
                <span className="text-text-muted text-sm">{ROLE_NAMES[member.role]}</span>
              )}

              {member.removable ? (
                <form action={removeAction}>
                  <input type="hidden" name="treeSlug" value={treeSlug} />
                  <input type="hidden" name="memberId" value={member.memberId} />
                  <button
                    type="submit"
                    disabled={removing}
                    aria-label={`Retirer ${member.name} de l’arbre`}
                    className="text-text-faint hover:text-danger text-sm disabled:opacity-60"
                  >
                    Retirer
                  </button>
                </form>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {state.status !== 'idle' && state.message ? (
        <p
          role="status"
          className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
            state.status === 'error'
              ? 'text-danger border-danger/30 bg-danger/10'
              : 'text-success border-success/30 bg-success/10'
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
