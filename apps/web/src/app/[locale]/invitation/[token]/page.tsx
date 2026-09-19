import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { findInvitation } from '@chronolignee/db';
import { AcceptInvitation } from '@/components/sharing/accept-invitation';
import { ROLE_DESCRIPTIONS, ROLE_NAMES } from '@/components/sharing/role-labels';
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

const UNUSABLE = {
  EXPIRED: 'Cette invitation a expiré. Demandez-en une nouvelle à qui vous l’a envoyée.',
  REVOKED: 'Cette invitation a été annulée par l’arbre qui l’avait envoyée.',
  USED: 'Cette invitation a déjà servi. Si c’était vous, l’arbre est dans votre liste.',
} as const;

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const [invitation, session] = await Promise.all([findInvitation(db, token), getSession()]);
  const here = `/invitation/${token}`;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-14">
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <Link
          href="/"
          className="font-editorial text-text-muted hover:text-text-primary text-lg tracking-tight"
        >
          Chronolignée
        </Link>

        {!invitation ? (
          <>
            <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
              Invitation introuvable
            </h1>
            <p className="text-text-muted">
              Ce lien ne mène à aucune invitation. Vérifiez qu’il a été copié en entier.
            </p>
          </>
        ) : invitation.status !== 'PENDING' ? (
          <>
            <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
              Invitation inutilisable
            </h1>
            <p className="text-text-muted">{UNUSABLE[invitation.status]}</p>
          </>
        ) : (
          <>
            <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
              Rejoindre « {invitation.treeName} »
            </h1>
            <p className="text-text-secondary">
              {invitation.invitedBy} vous invite comme{' '}
              <strong className="font-medium">{ROLE_NAMES[invitation.role].toLowerCase()}</strong> :{' '}
              {ROLE_DESCRIPTIONS[invitation.role].charAt(0).toLowerCase()}
              {ROLE_DESCRIPTIONS[invitation.role].slice(1)}
            </p>

            {!session ? (
              <div className="flex flex-col gap-3">
                <p className="text-text-muted text-sm">
                  L’invitation est adressée à {maskEmail(invitation.email)}. Connectez-vous avec
                  cette adresse, ou créez un compte avec elle.
                </p>
                <p className="flex gap-4">
                  <Link
                    href={{ pathname: '/sign-in', query: { next: here } }}
                    className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium"
                  >
                    Se connecter
                  </Link>
                  <Link
                    href={{ pathname: '/sign-up', query: { next: here } }}
                    className="text-accent self-center text-sm underline underline-offset-2"
                  >
                    Créer un compte
                  </Link>
                </p>
              </div>
            ) : session.user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
              <div className="flex flex-col gap-3">
                <p className="text-text-muted text-sm">
                  Vous êtes connecté·e avec une autre adresse. L’invitation est adressée à{' '}
                  {maskEmail(invitation.email)} : déconnectez-vous, puis ouvrez de nouveau ce lien.
                </p>
                <SignOutButton label="Se déconnecter" returnTo={here} />
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
