import { can, type TreeRole } from '@chronolignee/domain';
import { getTranslations } from 'next-intl/server';
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
export async function TreeNav({
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
    | 'overview'
    | 'statistics'
    | 'people'
    | 'timeline'
    | 'constellation'
    | 'stories'
    | 'map'
    | 'archive'
    | 'photos'
    | 'research'
    | 'proposals'
    | 'duplicates'
    | 'import'
    | 'history'
    | 'sharing'
    | 'settings';
}) {
  const t = await getTranslations('tree');
  const canEdit = can(role, 'contribute');
  const tabs = [
    { key: 'overview' as const, href: `/app/${treeSlug}`, label: t('nav.overview') },
    { key: 'people' as const, href: `/app/${treeSlug}/personnes`, label: t('nav.people') },
    { key: 'timeline' as const, href: `/app/${treeSlug}/chronologie`, label: t('nav.timeline') },
    ...(features.constellation
      ? [
          {
            key: 'constellation' as const,
            href: `/app/${treeSlug}/constellation`,
            label: t('nav.constellation'),
          },
        ]
      : []),
    ...(features.storyDirector
      ? [{ key: 'stories' as const, href: `/app/${treeSlug}/recits`, label: t('nav.stories') }]
      : []),
    { key: 'map' as const, href: `/app/${treeSlug}/carte`, label: t('nav.map') },
    { key: 'archive' as const, href: `/app/${treeSlug}/archives`, label: t('nav.archive') },
    { key: 'photos' as const, href: `/app/${treeSlug}/photos`, label: t('nav.photos') },
    {
      key: 'statistics' as const,
      href: `/app/${treeSlug}/statistiques`,
      label: t('nav.statistics'),
    },
    // Members only: it lists what the family does not know yet.
    ...(role !== null
      ? [
          {
            key: 'research' as const,
            href: `/app/${treeSlug}/recherche`,
            label: t('nav.research'),
          },
        ]
      : []),
    // Editors only: a proposal is a reading nobody has vouched for yet.
    ...(canEdit
      ? [
          {
            key: 'proposals' as const,
            href: `/app/${treeSlug}/propositions`,
            label: t('nav.proposals'),
          },
          {
            key: 'duplicates' as const,
            href: `/app/${treeSlug}/doublons`,
            label: t('nav.duplicates'),
          },
        ]
      : []),
    ...(can(role, 'import')
      ? [{ key: 'import' as const, href: `/app/${treeSlug}/import`, label: t('nav.import') }]
      : []),
  ];

  // The tree itself rather than its content: members only.
  const stewardship =
    role === null
      ? []
      : [
          { key: 'history' as const, href: `/app/${treeSlug}/historique`, label: t('nav.history') },
          { key: 'sharing' as const, href: `/app/${treeSlug}/partage`, label: t('nav.sharing') },
          ...(can(role, 'manageTree') || can(role, 'export') || can(role, 'deleteTree')
            ? [
                {
                  key: 'settings' as const,
                  href: `/app/${treeSlug}/reglages`,
                  label: t('nav.settings'),
                },
              ]
            : []),
        ];

  return (
    // Sticky, so moving between views never means scrolling back up; the
    // translucent ground keeps the page legible as it slides underneath.
    <header className="border-border-subtle bg-surface-0/85 supports-[backdrop-filter]:bg-surface-0/70 sticky top-0 z-30 -mx-6 -mt-4 flex flex-wrap items-baseline justify-between gap-4 border-b px-6 pt-4 pb-4 backdrop-blur-md">
      {/* Everything wraps: on a phone eleven links in one row pushed the
          whole page sideways, on every screen of a tree. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-2">
        <Link
          href={`/app/${treeSlug}`}
          className="font-editorial text-text-primary hover:text-accent text-lg tracking-tight transition-colors duration-[var(--duration-fast)]"
        >
          {treeName}
        </Link>
        <nav aria-label={t('sections')} className="flex flex-wrap gap-x-4 gap-y-1">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={tab.key === current ? 'page' : undefined}
              className={
                tab.key === current
                  ? 'text-text-primary border-accent border-b-2 pb-1 text-sm'
                  : 'text-text-muted hover:text-text-primary hover:border-border-strong border-b-2 border-transparent pb-1 text-sm transition-colors duration-[var(--duration-fast)]'
              }
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex flex-wrap items-baseline gap-4">
        {stewardship.length > 0 ? (
          <nav aria-label={t('stewardship')} className="flex flex-wrap gap-x-4 gap-y-1">
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
            {t('addPerson')}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
