import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { loadDuplicateReview } from '@/server/duplicates';
import { DuplicateReviewList } from '@/components/duplicates/duplicate-review';
import { TreeNav } from '@/components/people/tree-nav';

/** Dynamic: it reads the database, and the queue, on every request. */
export const dynamic = 'force-dynamic';

export default async function DoublonsPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('duplicates');
  const review = await loadDuplicateReview(treeSlug);
  // Editors only, and a visitor who is not one gets the answer a missing
  // page gives: the list would otherwise say which names look alike.
  if (!review) notFound();

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={review.access.treeName}
          role={review.access.role}
          current="duplicates"
        />

        <div className="flex flex-col gap-2">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-2xl text-sm">{t('lead')}</p>
          {!review.canMerge ? (
            <p className="text-text-faint text-xs">{t('mergeIsForStewards')}</p>
          ) : null}
        </div>

        <DuplicateReviewList
          treeSlug={treeSlug}
          pairs={review.pairs}
          scanState={review.scanState}
        />
      </div>
    </main>
  );
}
