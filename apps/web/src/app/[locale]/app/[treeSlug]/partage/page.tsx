import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { InviteForm } from '@/components/sharing/invite-form';
import { LeaveTree } from '@/components/sharing/leave-tree';
import { MemberList } from '@/components/sharing/member-list';
import { PendingInvitations } from '@/components/sharing/pending-invitations';
import { ROLE_DESCRIPTIONS, ROLE_NAMES } from '@/components/sharing/role-labels';
import { TreeNav } from '@/components/people/tree-nav';
import { loadSharing } from '@/server/sharing';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

export default async function SharingPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  // Members only. Someone reading a public tree gets the same answer as for a
  // page that does not exist: who researches a family is not published.
  const sharing = await loadSharing(treeSlug);
  if (!sharing) notFound();
  const { access } = sharing;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-10">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="sharing"
        />

        <div className="flex flex-col gap-2">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">Partage</h1>
          <p className="text-text-muted max-w-2xl text-sm">
            Vous êtes {ROLE_NAMES[access.role].toLowerCase()} de cet arbre :{' '}
            {ROLE_DESCRIPTIONS[access.role].charAt(0).toLowerCase()}
            {ROLE_DESCRIPTIONS[access.role].slice(1)}
          </p>
        </div>

        <section aria-labelledby="members-heading" className="flex flex-col gap-4">
          <h2 id="members-heading" className="text-text-faint text-xs tracking-wide uppercase">
            Membres
          </h2>
          <MemberList treeSlug={treeSlug} members={sharing.members} />
        </section>

        {sharing.canManage ? (
          <>
            <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
              <h2 id="invite-heading" className="text-text-faint text-xs tracking-wide uppercase">
                Inviter quelqu’un
              </h2>
              <InviteForm treeSlug={treeSlug} roles={sharing.invitableRoles} />
            </section>

            <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
              <h2 id="pending-heading" className="text-text-faint text-xs tracking-wide uppercase">
                Invitations en attente
              </h2>
              <PendingInvitations treeSlug={treeSlug} invitations={sharing.invitations} />
            </section>
          </>
        ) : null}

        <section aria-labelledby="leave-heading" className="flex flex-col gap-3">
          <h2 id="leave-heading" className="text-text-faint text-xs tracking-wide uppercase">
            Votre place dans l’arbre
          </h2>
          {sharing.lastOwner ? (
            <p className="text-text-muted text-sm">
              Vous êtes le seul propriétaire : pour quitter l’arbre, nommez d’abord un autre
              propriétaire parmi les membres.
            </p>
          ) : (
            <LeaveTree treeSlug={treeSlug} treeName={access.treeName} />
          )}
        </section>
      </div>
    </main>
  );
}
