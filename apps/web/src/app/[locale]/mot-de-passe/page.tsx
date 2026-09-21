import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordResetForm } from '@/components/auth/password-reset';
import { mailEnabled } from '@/lib/mail';

/**
 * Choosing a new password, with the token from the link.
 *
 * The token stays in the URL and is never rendered into the page: it is the
 * one secret in this flow, and a page that prints it hands it to every
 * screenshot and every over-the-shoulder reader.
 */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!mailEnabled) notFound();

  const query = await searchParams;
  const raw = typeof query.token === 'string' ? query.token : null;
  // Better Auth sends the reader here with ?error=INVALID_TOKEN when the link
  // has expired or was already used.
  const failed = typeof query.error === 'string';
  const token = failed ? null : raw;

  const t = await getTranslations('auth');
  const landing = await getTranslations('landing');

  return (
    <AuthShell
      title={t('resetTitle')}
      aside={
        <blockquote className="max-w-sm">
          <p className="font-editorial text-text-secondary text-lg leading-relaxed">
            {landing('pillars.time.body')}
          </p>
          <footer className="text-text-faint mt-4 text-sm">{landing('pillars.time.title')}</footer>
        </blockquote>
      }
    >
      <PasswordResetForm token={token} />
    </AuthShell>
  );
}
