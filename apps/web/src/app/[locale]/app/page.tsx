import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { SignOutButton } from '@/components/auth/sign-out-button';

/**
 * The application shell, currently a placeholder landing spot for a freshly
 * authenticated user. The dashboard proper (tree list, first-run choice
 * between manual entry, GEDCOM import and the demo dataset) lands in phase 2.
 *
 * What is real here is the guard: the session is read on the server, and an
 * unauthenticated request is redirected before any of this renders.
 */
/**
 * Dynamic, because it reads the database on every request.
 *
 * Stated rather than inferred: the locale layout declares generateStaticParams,
 * which makes every page under it a prerender candidate, and Next would
 * otherwise try to render this one at build time — against a database the build
 * container does not have.
 */
export const dynamic = 'force-dynamic';

export default async function AppPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const t = await getTranslations('auth');

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-14">
      <div className="mx-auto max-w-[var(--content-max)]">
        <header className="border-border-subtle flex items-center justify-between border-b pb-5">
          <span className="font-editorial text-text-primary text-lg tracking-tight">
            Chronolignée
          </span>
          <div className="flex items-center gap-4">
            <span className="text-text-muted text-sm">{session?.user.email}</span>
            <SignOutButton label={t('signOut')} />
          </div>
        </header>

        <p className="text-text-muted mt-10">
          Compte créé. Le tableau de bord arrive à la phase suivante.
        </p>
      </div>
    </main>
  );
}
