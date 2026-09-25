import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { findInvitation } from '@chronolignee/db';
import { AcceptInvitation } from '@/components/sharing/accept-invitation';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Link } from '@/i18n/navigation';
import { db } from '@/lib/db';
import { maskEmail } from '@/lib/mask-email';
import { getSession } from '@/lib/session';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

/**
 * The link is a credential: never indexed, never sent onward as a referrer.
 */
export const metadata: Metadata = {
  title: 'Invitation — Chronolignée',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('invitation');
  const roles = await getTranslations('tree.roles');
  const roleDescriptions = await getTranslations('tree.roleDescriptions');
  const common = await getTranslations('common');
  const [invitation, session] = await Promise.all([findInvitation(db, token), getSession()]);
  const here = `/invitation/${token}`;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-14">
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <Link
          href="/"
          className="font-editorial text-text-muted hover:text-text-primary text-lg tracking-tight"
        >
          {common('appName')}
        </Link>

        {!invitation ? (
          <>
            <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
              {t('notFound')}
            </h1>
            <p className="text-text-muted">{t('unknown')}</p>
          </>
        ) : invitation.status !== 'PENDING' ? (
          <>
            <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
              {t('unusableTitle')}
            </h1>
            <p className="text-text-muted">{t(invitation.status)}</p>
          </>
        ) : (
          <>
            <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
              {t('joinTitle', { tree: invitation.treeName })}
            </h1>
            <p className="text-text-secondary">
              {t('invitesYou', {
                inviter: invitation.invitedBy,
                role: roles(invitation.role).toLowerCase(),
                description: roleDescriptions(invitation.role),
              })}
            </p>

            {!session ? (
              <div className="flex flex-col gap-3">
                <p className="text-text-muted text-sm">
                  {t('signInWith', { email: maskEmail(invitation.email) })}
                </p>
                <p className="flex gap-4">
                  <Link
                    href={{ pathname: '/sign-in', query: { next: here } }}
                    className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium"
                  >
                    {t('signIn')}
                  </Link>
                  <Link
                    href={{ pathname: '/sign-up', query: { next: here } }}
                    className="text-accent self-center text-sm underline underline-offset-2"
                  >
                    {t('createAccount')}
                  </Link>
                </p>
              </div>
            ) : session.user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
              <div className="flex flex-col gap-3">
                <p className="text-text-muted text-sm">
                  {t('otherAddress', { email: maskEmail(invitation.email) })}
                </p>
                <SignOutButton label={t('signOut')} returnTo={here} />
              </div>
            ) : (
              <AcceptInvitation token={token} treeName={invitation.treeName} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
