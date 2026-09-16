import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listTreesForUser } from '@chronolignee/db';
import { redirect } from '@/i18n/navigation';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { TreeDashboard } from '@/components/trees/tree-dashboard';

/**
 * The application shell: the trees this account can open, and the way to make
 * another one.
 *
 * The guard is the point. The session is read on the server, and an
 * unauthenticated request is redirected before any of this renders — and the
 * list comes from membership rows, so it cannot show a tree the account was
 * never given.
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
  const trees = session ? await listTreesForUser(db, session.user.id) : [];

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

        <div className="mt-10">
          <TreeDashboard trees={trees} />
        </div>
      </div>
    </main>
  );
}
