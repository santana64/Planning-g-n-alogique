import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { PasswordResetRequestForm } from '@/components/auth/password-reset';
import { mailEnabled } from '@/lib/mail';

/**
 * Asking for a reset link.
 *
 * Absent — a 404, like any page that does not exist — on an instance that
 * cannot send mail: a form that silently leads nowhere is worse than no form.
 */
export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!mailEnabled) notFound();

  const t = await getTranslations('auth');
  const landing = await getTranslations('landing');

  return (
    <AuthShell
      title={t('forgotPassword')}
      aside={
        <blockquote className="max-w-sm">
          <p className="font-editorial text-text-secondary text-lg leading-relaxed">
            {landing('pillars.evidence.body')}
          </p>
          <footer className="text-text-faint mt-4 text-sm">
            {landing('pillars.evidence.title')}
          </footer>
        </blockquote>
      }
    >
      <PasswordResetRequestForm />
      <p className="text-text-muted mt-6 text-sm">
        <Link
          href="/sign-in"
          className="text-accent hover:text-accent-hover underline underline-offset-2"
        >
          {t('signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
