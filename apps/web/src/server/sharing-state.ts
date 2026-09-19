import type { ActionState } from './action-state';

/**
 * What the invitation form gets back.
 *
 * The link is here exactly once: only its hash is stored, so if the inviter
 * closes the page without copying it, the remedy is a new invitation — which
 * also cancels this one.
 */
export interface InviteState extends ActionState {
  readonly link?: string;
  readonly expiresAt?: string;
}

export const IDLE_INVITE: InviteState = { status: 'idle' };
