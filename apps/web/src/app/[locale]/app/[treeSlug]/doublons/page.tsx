import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
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
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">Doublons</h1>
          <p className="text-text-muted max-w-2xl text-sm">
            Deux imports d’une même famille laissent la même personne deux fois. La recherche
            rapproche les fiches dont les noms se ressemblent, puis pèse les dates, les parents, les
            enfants et les lieux. Elle propose : elle ne fusionne jamais, et un père et son fils du
            même nom restent deux personnes.
          </p>
          {!review.canMerge ? (
            <p className="text-text-faint text-xs">
              Fusionner retire une fiche de l’arbre : seuls les responsables peuvent le faire. Vous
              pouvez comparer les fiches et écarter les rapprochements erronés.
            </p>
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
