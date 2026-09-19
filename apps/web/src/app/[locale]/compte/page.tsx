import { setRequestLocale } from 'next-intl/server';
import { EraseAccount } from '@/components/account/erase-account';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Link, redirect } from '@/i18n/navigation';
import { loadAccount } from '@/server/account';
import { getAIStatus } from '@/server/ai';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const account = await loadAccount();
  if (!account) {
    redirect({ href: { pathname: '/sign-in', query: { next: '/compte' } }, locale });
    return null;
  }
  const ai = getAIStatus();
  const { plan } = account;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-14">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <Link href="/app" className="text-text-faint hover:text-accent text-sm">
          ← Mes arbres
        </Link>

        <div className="flex flex-col gap-1">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">Mon compte</h1>
          <p className="text-text-muted text-sm">
            {account.name} · {account.email} · créé le {DAY.format(new Date(account.createdAt))}
          </p>
        </div>

        <section aria-labelledby="data-heading" className="flex flex-col gap-3">
          <h2 id="data-heading" className="text-text-faint text-xs tracking-wide uppercase">
            Mes données
          </h2>
          <p className="text-text-secondary text-sm">
            Tout ce que cette instance conserve sur votre compte — profil, arbres et rôles,
            invitations envoyées, sessions avec l’adresse et le navigateur d’où elles ont été
            ouvertes — dans un fichier JSON. Les arbres eux-mêmes s’exportent au format GEDCOM
            depuis leurs réglages.
          </p>
          {/* A plain anchor: this is a download, not a page to prefetch. */}
          <a
            href="/api/account/export"
            download
            className="text-accent self-start text-sm underline underline-offset-2"
          >
            Télécharger mes données
          </a>
        </section>

        <section aria-labelledby="ai-heading" className="flex flex-col gap-3">
          <h2 id="ai-heading" className="text-text-faint text-xs tracking-wide uppercase">
            Lecture automatique
          </h2>
          {ai.enabled ? (
            <p className="text-text-secondary text-sm">
              Lecteur configuré sur cette instance : {ai.label}.{' '}
              {ai.sendsDataExternally
                ? 'Quand un éditeur le demande, la transcription citée est envoyée à ce service pour y relever des faits ; rien n’est envoyé sans ce geste, et rien de ce qu’il propose n’entre dans l’arbre sans être accepté par une personne.'
                : 'Il fonctionne sur ce serveur : aucune transcription ne quitte l’instance.'}
            </p>
          ) : (
            <p className="text-text-secondary text-sm">
              La lecture automatique est désactivée sur cette instance : aucun texte n’est envoyé à
              un service d’intelligence artificielle.
            </p>
          )}
        </section>

        <section
          aria-labelledby="erase-heading"
          className="border-danger/30 flex flex-col gap-4 rounded-[var(--radius-lg)] border p-5"
        >
          <h2 id="erase-heading" className="text-danger text-xs tracking-wide uppercase">
            Supprimer mon compte
          </h2>

          {plan.blocking.length > 0 ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-text-secondary">
                Vous êtes le seul propriétaire d’arbres où d’autres personnes travaillent. Nommez
                d’abord un autre propriétaire, ou supprimez ces arbres :
              </p>
              <ul className="flex flex-col gap-1">
                {plan.blocking.map((tree) => (
                  <li key={tree.treeId}>
                    <Link
                      href={`/app/${tree.slug}/partage`}
                      className="text-accent underline underline-offset-2"
                    >
                      {tree.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="text-text-secondary flex flex-col gap-2 text-sm">
                <p>
                  Votre compte, vos sessions et vos adhésions sont effacés. Dans les arbres
                  partagés, vos contributions restent — elles font partie de la recherche de la
                  famille — mais l’historique ne dit plus qui les a faites.
                </p>
                {plan.erasedWithAccount.length > 0 ? (
                  <p>
                    Supprimés avec le compte, car vous en êtes le seul membre :{' '}
                    {plan.erasedWithAccount.map((tree) => `« ${tree.name} »`).join(', ')}.
                    Exportez-les d’abord si vous voulez les garder.
                  </p>
                ) : null}
                {plan.left.length > 0 ? (
                  <p>
                    Arbres que vous quittez :{' '}
                    {plan.left.map((tree) => `« ${tree.name} »`).join(', ')}.
                  </p>
                ) : null}
              </div>

              {account.freshSession ? (
                <EraseAccount email={account.email} />
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-text-muted text-sm">
                    Pour confirmer qu’il s’agit bien de vous, reconnectez-vous : la suppression
                    demande une connexion de moins de quinze minutes.
                  </p>
                  <SignOutButton label="Me reconnecter" returnTo="/sign-in?next=/compte" />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
