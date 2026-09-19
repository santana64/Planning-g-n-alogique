import type { ReactNode } from 'react';
import { can } from '@chronolignee/domain';
import { resolveTreeAccess } from '@/server/access';
import { CommandPalette } from '@/components/search/command-palette';

/**
 * Everything under one tree.
 *
 * Exists to mount the command palette once for every screen of a tree rather
 * than in each page, so ⌘K works on the timeline, on a person, and on the
 * import screen without three copies of the same listener.
 *
 * `canEdit` and `canImport` are resolved here, on the server, from membership.
 * The palette uses them only to decide which commands to offer — the pages and actions it leads
 * to check again on arrival, because a hidden command is not a permission.
 */
export default async function TreeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ treeSlug: string }>;
}) {
  const { treeSlug } = await params;
  const access = await resolveTreeAccess(treeSlug);

  return (
    <>
      {children}
      {/* No access means the page below is already rendering a 404; mounting
       * a search box over it would be the one thing on screen that worked. */}
      {access ? (
        <CommandPalette
          treeSlug={treeSlug}
          canEdit={access.canEdit}
          canImport={can(access.role, 'import')}
        />
      ) : null}
    </>
  );
}
