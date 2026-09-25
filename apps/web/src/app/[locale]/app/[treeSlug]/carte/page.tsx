import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { loadAtlasSnapshot } from '@/server/atlas';
import { AtlasView } from '@/components/map/atlas-view';
import { TreeNav } from '@/components/people/tree-nav';

/**
 * Dynamic, because it reads the database on every request.
 *
 * Stated rather than inferred: the locale layout declares generateStaticParams,
 * which makes every page under it a prerender candidate, and Next would
 * otherwise try to render this one at build time — against a database the build
 * container does not have.
 */
export const dynamic = 'force-dynamic';

export default async function CartePage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('atlas');
  const snapshot = await loadAtlasSnapshot(treeSlug);
  if (!snapshot) notFound();

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-6">
        <TreeNav
          treeSlug={treeSlug}
          treeName={snapshot.access.treeName}
          role={snapshot.access.role}
          current="map"
        />

        <div className="flex flex-col gap-1">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted text-sm">{t('lead')}</p>
        </div>

        {snapshot.points.length === 0 ? (
          <p className="border-border-subtle text-text-muted rounded-[var(--radius-lg)] border border-dashed p-10">
            {t('noCoordinates')}
          </p>
        ) : (
          <AtlasView snapshot={snapshot} />
        )}
      </div>
    </main>
  );
}
