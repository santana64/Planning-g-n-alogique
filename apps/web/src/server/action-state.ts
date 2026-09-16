/**
 * The shape a form action returns.
 *
 * In its own module because a `'use server'` file may only export async
 * functions: a constant exported alongside the actions fails the build, and
 * the failure names the file rather than the rule, which is a confusing five
 * minutes for whoever meets it next.
 */

export interface ActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
  /** Per-field messages, keyed by form field name. */
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /** Non-blocking findings. The write happened; these are worth reading. */
  readonly warnings?: readonly string[];
  readonly personId?: string;
}

export const IDLE: ActionState = { status: 'idle' };
