import { Link } from '@/i18n/navigation';

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
  canEdit,
  current,
}: {
  treeSlug: string;
  treeName: string;
  canEdit: boolean;
  current: 'people' | 'timeline' | 'map' | 'import';
}) {
  const tabs = [
    { key: 'people' as const, href: `/app/${treeSlug}/personnes`, label: 'Personnes' },
    { key: 'timeline' as const, href: `/app/${treeSlug}/chronologie`, label: 'Chronologie' },
    { key: 'map' as const, href: `/app/${treeSlug}/carte`, label: 'Carte' },
    ...(canEdit
      ? [{ key: 'import' as const, href: `/app/${treeSlug}/import`, label: 'Importer' }]
      : []),
  ];

  return (
    <header className="border-border-subtle flex flex-wrap items-baseline justify-between gap-4 border-b pb-4">
      <div className="flex items-baseline gap-4">
        <span className="font-editorial text-text-primary text-lg tracking-tight">{treeName}</span>
        <nav aria-label="Sections de l’arbre" className="flex gap-4">
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

      {canEdit ? (
        <Link
          href={`/app/${treeSlug}/personnes/nouvelle`}
          className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)]"
        >
          Ajouter une personne
        </Link>
      ) : null}
    </header>
  );
}
