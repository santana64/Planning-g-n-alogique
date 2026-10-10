import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { features } from '@/lib/env';
import { TreeNav } from '@/components/people/tree-nav';
import { RiverView } from '@/components/river/river-view';
import { loadRiver } from '@/server/river';
import { resolveTreeAccess } from '@/server/access';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

export default async function RiverPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  if (!features.river) notFound();

  const [access, river] = await Promise.all([resolveTreeAccess(treeSlug), loadRiver(treeSlug)]);
  if (!access || !river) notFound();
  const t = await getTranslations('river');

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-8">
      <div className="mx-auto flex max-w-[var(--content-wide,96rem)] flex-col gap-6">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="river"
        />
        <div className="flex flex-col gap-1">
          <h1 className="font-editorial text-text-primary text-2xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-3xl text-sm">{t('lead')}</p>
        </div>
        {river.layout.streams.length === 0 ? (
          <p className="text-text-faint text-sm">{t('empty')}</p>
        ) : (
          <RiverView data={river} treeSlug={treeSlug} />
        )}
        <p className="text-text-faint max-w-3xl text-xs">{t('caveat')}</p>
      </div>
    </main>
  );
}
