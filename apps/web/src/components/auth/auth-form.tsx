'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { signIn, signUp } from '@/lib/auth-client';
import { Field } from './field';
import { VerificationNotice } from './verification-notice';

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

/**
 * `next` is where to go once signed in — an invitation, typically. The page
 * validates it (`safeReturnPath`) before passing it here; this form never
 * reads it from the URL itself.
 *
 * `verificationRequired` says whether this instance can send mail, and
 * therefore whether a new account has to confirm its address before it can
 * be used. When it does, the form stays on the page and explains rather than
 * pushing someone to an application that would bounce them straight back.
 */
export function AuthForm({
  mode,
  next = null,
  verificationRequired = false,
}: {
  mode: Mode;
  next?: string | null;
  verificationRequired?: boolean;
}) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** The address waiting for a confirmation, when there is one. */
  const [awaiting, setAwaiting] = useState<string | null>(null);

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

    // `callbackURL` is where a confirmation link lands: back on the invitation
    // someone was in the middle of accepting, not on a generic home page they
    // then have to leave again. Signing in needs it too — an unconfirmed
    // address sends the link again from there.
    const callbackURL = next ?? '/app';
    const result =
      mode === 'sign-in'
        ? await signIn.email({ email, password, callbackURL })
        : await signUp.email({ email, password, name, callbackURL });

    if (result.error) {
      // The address exists but has not been confirmed. Better Auth has just
      // sent the link again (`sendOnSignIn`), so the page says so instead of
      // showing a dead end.
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        setAwaiting(email);
        return;
      }
      setErrorKey(messageKeyFor(mode, result.error.status, result.error.code));
      return;
    }

    if (mode === 'sign-up' && verificationRequired) {
      setAwaiting(email);
      return;
    }

    startTransition(() => {
      router.push(next ?? '/app');
      router.refresh();
    });
  }

  if (awaiting) return <VerificationNotice email={awaiting} />;

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

      {mode === 'sign-in' && verificationRequired && (
        <Link
          href="/mot-de-passe-oublie"
          className="text-text-muted hover:text-text-primary self-start text-sm underline underline-offset-2"
        >
          {t('forgotPassword')}
        </Link>
      )}
    </form>
  );
}
