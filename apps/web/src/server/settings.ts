import 'server-only';
import { cache } from 'react';
import { can, type TreeRole } from '@chronolignee/domain';
import { db } from '@/lib/db';
import { resolveTreeAccess, type TreeAccess } from './access';

/**
 * What the settings page shows, to those who may use some of it.
 *
 * Three rights meet here — change the settings, take the tree away as a file,
 * erase it — and each section is offered only to a role the permission table
 * grants it to. Everyone else gets the page that does not exist.
 */

export interface TreeSettingsView {
  readonly access: TreeAccess & { readonly role: TreeRole };
  readonly canManage: boolean;
  readonly canExport: boolean;
  readonly canDelete: boolean;
  readonly settings: {
    readonly name: string;
    readonly description: string;
    readonly visibility: 'PRIVATE' | 'LINK' | 'PUBLIC';
    readonly redactLivingPeople: boolean;
  };
  readonly counts: {
    readonly people: number;
    readonly documents: number;
    readonly members: number;
  };
}

export const loadTreeSettings = cache(
  async (treeSlug: string): Promise<TreeSettingsView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access || access.role === null) return null;
    const role = access.role;
    const canManage = can(role, 'manageTree');
    const canExport = can(role, 'export');
    const canDelete = can(role, 'deleteTree');
    if (!canManage && !canExport && !canDelete) return null;

    const [tree, people, documents, members] = await Promise.all([
      db.tree.findUniqueOrThrow({
        where: { id: access.treeId },
        select: { name: true, description: true, visibility: true, redactLivingPeople: true },
      }),
      db.person.count({ where: { treeId: access.treeId, deletedAt: null } }),
      db.document.count({ where: { treeId: access.treeId } }),
      db.treeMember.count({ where: { treeId: access.treeId } }),
    ]);

    return {
      access: { ...access, role },
      canManage,
      canExport,
      canDelete,
      settings: {
        name: tree.name,
        description: tree.description ?? '',
        visibility: tree.visibility,
        redactLivingPeople: tree.redactLivingPeople,
      },
      counts: { people, documents, members },
    };
  },
);
