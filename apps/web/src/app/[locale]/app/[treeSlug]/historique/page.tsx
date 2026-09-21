import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HistoryList } from '@/components/history/history-list';
import { TreeNav } from '@/components/people/tree-nav';
import { Link } from '@/i18n/navigation';
import { loadTreeHistory } from '@/server/history';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
  searchParams: Promise<{ apres?: string | string[] }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('history');
  const { apres } = await searchParams;
  const cursor = typeof apres === 'string' ? apres : null;

  // Members only: the history names the people who research this tree.
  const history = await loadTreeHistory(treeSlug, cursor);
  if (!history) notFound();
  const { access } = history;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="history"
        />

        <div className="flex flex-col gap-2">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-2xl text-sm">{t('lead')}</p>
        </div>

        <HistoryList treeSlug={treeSlug} lines={history.lines} />

        <nav aria-label={t('pages')} className="flex gap-6 text-sm">
          {cursor ? (
            <Link href={`/app/${treeSlug}/historique`} className="text-accent hover:underline">
              ← {t('newest')}
            </Link>
          ) : null}
          {history.nextCursor ? (
            <Link
              href={{
                pathname: `/app/${treeSlug}/historique`,
                query: { apres: history.nextCursor },
              }}
              className="text-accent hover:underline"
            >
              {t('older')} →
            </Link>
          ) : null}
        </nav>
      </div>
    </main>
  );
}
