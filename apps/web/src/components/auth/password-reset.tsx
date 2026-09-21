'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { Field } from './field';

/**
 * Losing a password must not mean losing the archive.
 *
 * Two forms: asking for a link, and choosing a new password with it.
 *
 * The first one **always answers the same thing**, whether or not the address
 * has an account. Saying "no account with that address" would turn this page
 * into a way of finding out who is registered — and who researches a family
 * is not public information.
 */

function Message({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
        tone === 'error'
          ? 'text-danger border-danger/30 bg-danger/10'
          : 'text-success border-success/30 bg-success/10'
      }`}
    >
      {children}
    </p>
  );
}

export function PasswordResetRequestForm() {
  const t = useTranslations('auth');
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    const result = await authClient.requestPasswordReset({ email, redirectTo: '/mot-de-passe' });
    setPending(false);
    // A rate limit is the one failure worth showing: it is about the sender,
    // not about whether the address exists.
    if (result.error && result.error.status === 429) {
      setFailed(true);
      return;
    }
    setSent(true);
  }

  if (sent) return <Message tone="ok">{t('forgotSent')}</Message>;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-text-muted text-sm">{t('forgotIntro')}</p>
      <Field
        id={`${formId}-email`}
        name="email"
        label={t('email')}
        type="email"
        autoComplete="email"
        required
      />
      {failed && <Message tone="error">{t('errors.rateLimited')}</Message>}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-contrast hover:bg-accent-hover mt-2 rounded-[var(--radius-md)] px-5 py-2.5 font-medium transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t('forgotSubmit')}
      </button>
    </form>
  );
}

export function PasswordResetForm({ token }: { token: string | null }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKey(null);
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (password.length < 12) {
      setErrorKey('errors.weakPassword');
      return;
    }

    setPending(true);
    const result = await authClient.resetPassword({ newPassword: password, token: token ?? '' });
    setPending(false);
    if (result.error) {
      setErrorKey(result.error.status === 429 ? 'errors.rateLimited' : 'errors.resetLinkInvalid');
      return;
    }
    setDone(true);
  }

  // A link without its token is a link that was truncated on the way here.
  if (!token) return <Message tone="error">{t('errors.resetLinkInvalid')}</Message>;

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Message tone="ok">{t('resetDone')}</Message>
        <button
          type="button"
          onClick={() => router.push('/sign-in')}
          className="bg-accent text-accent-contrast hover:bg-accent-hover self-start rounded-[var(--radius-md)] px-5 py-2.5 font-medium"
        >
          {t('signIn')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-text-muted text-sm">{t('resetIntro')}</p>
      <Field
        id={`${formId}-password`}
        name="password"
        label={t('newPassword')}
        type="password"
        autoComplete="new-password"
        required
        hint={t('passwordHint')}
      />
      {errorKey && <Message tone="error">{t(errorKey)}</Message>}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-contrast hover:bg-accent-hover mt-2 rounded-[var(--radius-md)] px-5 py-2.5 font-medium transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t('resetSubmit')}
      </button>
    </form>
  );
}
