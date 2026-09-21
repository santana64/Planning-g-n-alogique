import { can, type TreeRole } from '@chronolignee/domain';
import { Link } from '@/i18n/navigation';
import { features } from '@/lib/env';

/**
 * The header shared by every screen of one tree.
 *
 * A server component, so the links it renders are decided by the access the
 * server resolved — not by a role a client sent. It still only hides links:
 * the mutation itself is authorised again on arrival, because a hidden link is
 * not a permission.
 */
export function TreeNav({
  treeSlug,
  treeName,
  role,
  current,
}: {
  treeSlug: string;
  treeName: string;
  /** Null for someone reading a public tree from outside. */
  role: TreeRole | null;
  current:
    | 'people'
    | 'timeline'
    | 'constellation'
    | 'stories'
    | 'map'
    | 'archive'
    | 'proposals'
    | 'duplicates'
    | 'import'
    | 'history'
    | 'sharing'
    | 'settings';
}) {
  const canEdit = can(role, 'contribute');
  const tabs = [
    { key: 'people' as const, href: `/app/${treeSlug}/personnes`, label: 'Personnes' },
    { key: 'timeline' as const, href: `/app/${treeSlug}/chronologie`, label: 'Chronologie' },
    ...(features.constellation
      ? [
          {
            key: 'constellation' as const,
            href: `/app/${treeSlug}/constellation`,
            label: 'Constellation',
          },
        ]
      : []),
    ...(features.storyDirector
      ? [{ key: 'stories' as const, href: `/app/${treeSlug}/recits`, label: 'Récits' }]
      : []),
    { key: 'map' as const, href: `/app/${treeSlug}/carte`, label: 'Carte' },
    { key: 'archive' as const, href: `/app/${treeSlug}/archives`, label: 'Archives' },
    // Editors only: a proposal is a reading nobody has vouched for yet.
    ...(canEdit
      ? [
          {
            key: 'proposals' as const,
            href: `/app/${treeSlug}/propositions`,
            label: 'Propositions',
          },
          { key: 'duplicates' as const, href: `/app/${treeSlug}/doublons`, label: 'Doublons' },
        ]
      : []),
    ...(can(role, 'import')
      ? [{ key: 'import' as const, href: `/app/${treeSlug}/import`, label: 'Importer' }]
      : []),
  ];

  // The tree itself rather than its content: members only.
  const stewardship =
    role === null
      ? []
      : [
          { key: 'history' as const, href: `/app/${treeSlug}/historique`, label: 'Historique' },
          { key: 'sharing' as const, href: `/app/${treeSlug}/partage`, label: 'Partage' },
          ...(can(role, 'manageTree') || can(role, 'export') || can(role, 'deleteTree')
            ? [{ key: 'settings' as const, href: `/app/${treeSlug}/reglages`, label: 'Réglages' }]
            : []),
        ];

  return (
    <header className="border-border-subtle flex flex-wrap items-baseline justify-between gap-4 border-b pb-4">
      {/* Everything wraps: on a phone eleven links in one row pushed the
          whole page sideways, on every screen of a tree. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="font-editorial text-text-primary text-lg tracking-tight">{treeName}</span>
        <nav aria-label="Sections de l’arbre" className="flex flex-wrap gap-x-4 gap-y-1">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={tab.key === current ? 'page' : undefined}
              className={
                tab.key === current
                  ? 'text-text-primary border-accent border-b-2 pb-1 text-sm'
                  : 'text-text-muted hover:text-text-primary pb-1 text-sm'
              }
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex flex-wrap items-baseline gap-4">
        {stewardship.length > 0 ? (
          <nav aria-label="L’arbre" className="flex flex-wrap gap-x-4 gap-y-1">
            {stewardship.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={tab.key === current ? 'page' : undefined}
                className={
                  tab.key === current
                    ? 'text-text-primary border-accent border-b-2 pb-1 text-sm'
                    : 'text-text-faint hover:text-text-primary pb-1 text-sm'
                }
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        ) : null}
        {canEdit ? (
          <Link
            href={`/app/${treeSlug}/personnes/nouvelle`}
            className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)]"
          >
            Ajouter une personne
          </Link>
        ) : null}
      </div>
    </header>
  );
}
