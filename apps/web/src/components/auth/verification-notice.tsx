'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { authClient } from '@/lib/auth-client';

/**
 * After signing up on an instance that can send mail: the account exists, and
 * nothing else happens until the address is confirmed.
 *
 * The address is shown as typed, because the commonest reason a confirmation
 * never arrives is a typo in it — and the commonest second reason is that it
 * went to spam, which the page says before anyone has to ask.
 */
export function VerificationNotice({ email }: { email: string }) {
  const t = useTranslations('auth');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function resend() {
    setState('sending');
    const result = await authClient.sendVerificationEmail({ email, callbackURL: '/app' });
    setState(result.error ? 'failed' : 'sent');
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-secondary">{t('verifyIntro', { email })}</p>
      <p className="text-text-faint text-sm">{t('verifySpam')}</p>

      {state === 'sent' && (
        <p
          role="status"
          className="text-success border-success/30 bg-success/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {t('verifyResent')}
        </p>
      )}
      {state === 'failed' && (
        <p
          role="alert"
          className="text-danger border-danger/30 bg-danger/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {t('errors.unexpected')}
        </p>
      )}

      <button
        type="button"
        onClick={() => void resend()}
        disabled={state === 'sending'}
        className="border-border-default text-text-primary hover:border-border-strong self-start rounded-[var(--radius-md)] border px-4 py-2 text-sm disabled:opacity-60"
      >
        {t('verifyResend')}
      </button>
    </div>
  );
}
