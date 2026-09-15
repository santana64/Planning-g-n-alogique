import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthForm } from '@/components/auth/auth-form';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  const landing = await getTranslations('landing');

  return (
    <AuthShell
      title={t('signInTitle')}
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
      <AuthForm mode="sign-in" />
      <p className="text-text-muted mt-6 text-sm">
        {t('noAccount')}{' '}
        <Link
          href="/sign-up"
          className="text-accent hover:text-accent-hover underline underline-offset-2"
        >
          {t('signUp')}
        </Link>
      </p>
    </AuthShell>
  );
}
