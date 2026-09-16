'use client';

import type { ReactNode } from 'react';

/**
 * Form primitives.
 *
 * Deliberately small: a label, a control, a hint, an error. Not a design
 * system — there are four screens, and an abstraction built for four screens
 * costs more to read than the markup it replaces.
 *
 * What they do enforce is the part that is easy to get wrong by hand: every
 * control has a real `<label for>`, every error is tied to its field with
 * `aria-describedby`, and an invalid field says so with `aria-invalid` rather
 * than only turning red.
 */

const CONTROL =
  'w-full rounded-[var(--radius-md)] border border-border-default bg-surface-1 px-3 py-2 text-text-primary placeholder:text-text-faint transition-colors duration-[var(--duration-fast)] hover:border-border-strong focus:border-accent focus:outline-none';

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-text-secondary text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-text-faint text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  id,
  name,
  defaultValue,
  placeholder,
  hasHint = false,
  error,
  autoComplete = 'off',
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  /** Whether the surrounding Field renders a hint, so it can be referenced. */
  hasHint?: boolean;
  error?: string | undefined;
  autoComplete?: string;
}) {
  return (
    <input
      id={id}
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      autoComplete={autoComplete}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : hasHint ? `${id}-hint` : undefined}
      className={CONTROL}
    />
  );
}

export function Select({
  id,
  name,
  defaultValue,
  options,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue} className={CONTROL}>
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({
  id,
  name,
  defaultValue,
  rows = 4,
  placeholder,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      id={id}
      name={name}
      rows={rows}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className={`${CONTROL} resize-y`}
    />
  );
}

export function SubmitButton({
  children,
  pending,
  disabled = false,
  tone = 'primary',
}: {
  children: ReactNode;
  pending: boolean;
  /** Genuinely disabled, not merely dimmed: a greyed-out button that still
   * submits on Enter is worse than no guard at all. */
  disabled?: boolean;
  tone?: 'primary' | 'danger';
}) {
  const palette =
    tone === 'danger'
      ? 'border-danger/40 text-danger hover:bg-danger/10'
      : 'border-transparent bg-accent text-accent-contrast hover:bg-accent-hover';

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`rounded-[var(--radius-md)] border px-4 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60 ${palette}`}
    >
      {/* The label changes rather than a spinner appearing next to a label that
       * still says "Enregistrer": the button should not claim to be idle. */}
      {pending ? 'Enregistrement…' : children}
    </button>
  );
}
