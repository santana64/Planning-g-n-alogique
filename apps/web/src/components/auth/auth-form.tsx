'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { signIn, signUp } from '@/lib/auth-client';

type Mode = 'sign-in' | 'sign-up';

/**
 * Map a Better Auth failure onto a message we are willing to show.
 *
 * Deliberately lossy. A sign-in failure always reads as "wrong email or
 * password" whichever half was wrong, because distinguishing them turns the
 * form into an account-enumeration oracle: an attacker learns which addresses
 * are registered simply by watching which error comes back.
 */
function messageKeyFor(mode: Mode, status: number | undefined, code: string | undefined): string {
  if (status === 429) return 'errors.rateLimited';

  if (mode === 'sign-up') {
    if (code === 'USER_ALREADY_EXISTS') return 'errors.emailTaken';
    if (code === 'PASSWORD_TOO_SHORT') return 'errors.weakPassword';
    if (code === 'INVALID_EMAIL') return 'errors.invalidEmail';
  }

  if (mode === 'sign-in' && (status === 401 || status === 400)) {
    return 'errors.invalidCredentials';
  }

  return 'errors.unexpected';
}

export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const formId = useId();
  const nameId = `${formId}-name`;
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const errorId = `${formId}-error`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);

    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
    const name = String(data.get('name') ?? '');

    if (mode === 'sign-up' && name.trim().length === 0) {
      setErrorKey('errors.nameRequired');
      return;
    }
    if (mode === 'sign-up' && password.length < 12) {
      setErrorKey('errors.weakPassword');
      return;
    }

    const result =
      mode === 'sign-in'
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name });

    if (result.error) {
      setErrorKey(messageKeyFor(mode, result.error.status, result.error.code));
      return;
    }

    startTransition(() => {
      router.push('/app');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {mode === 'sign-up' && (
        <Field id={nameId} name="name" label={t('name')} type="text" autoComplete="name" required />
      )}

      <Field
        id={emailId}
        name="email"
        label={t('email')}
        type="email"
        autoComplete="email"
        required
        {...(errorKey ? { describedBy: errorId } : {})}
      />

      <Field
        id={passwordId}
        name="password"
        label={t('password')}
        type="password"
        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        required
        {...(mode === 'sign-up' ? { hint: t('passwordHint') } : {})}
        {...(errorKey ? { describedBy: errorId } : {})}
      />

      {/* role="alert" so a screen reader announces the failure without the
          user having to go looking for it. */}
      {errorKey && (
        <p
          id={errorId}
          role="alert"
          className="text-danger border-danger/30 bg-danger/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {t(errorKey)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-contrast hover:bg-accent-hover mt-2 rounded-[var(--radius-md)] px-5 py-2.5 font-medium transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {mode === 'sign-in' ? t('signIn') : t('signUp')}
      </button>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  type,
  autoComplete,
  required,
  hint,
  describedBy,
}: {
  id: string;
  name: string;
  label: string;
  type: string;
  autoComplete: string;
  required?: boolean;
  hint?: string;
  describedBy?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const described = [hintId, describedBy].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {/* A real <label>, not a placeholder. Placeholder-as-label disappears the
          moment someone starts typing, which is exactly when they need it. */}
      <label htmlFor={id} className="text-text-secondary text-sm">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        aria-describedby={described}
        className="bg-surface-1 border-border-default text-text-primary focus:border-accent rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] outline-none"
      />
      {hint && (
        <p id={hintId} className="text-text-faint text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
