import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAIStatus } from '@/server/ai';
import { loadPendingForTree } from '@/server/proposals';
import { ProposalReview } from '@/components/ai/proposal-review';
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

export default async function PropositionsPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('proposals');
  const pending = await loadPendingForTree(treeSlug);
  // Proposals are work in progress, for editors only. A visitor who is not
  // one gets the same answer as for a page that does not exist.
  if (!pending || !pending.access.canEdit) notFound();

  const ai = getAIStatus();
  const unassigned = pending.rows.filter((row) => row.personId === null).length;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={pending.access.treeName}
          role={pending.access.role}
          current="proposals"
        />

        <div className="flex flex-col gap-2">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-2xl text-sm">{t('lead')}</p>
          <p className="text-text-faint text-xs">
            {ai.enabled ? t('reader', { label: ai.label }) : t('readingDisabled')}
          </p>
        </div>

        {unassigned > 0 ? (
          <p className="text-warning text-sm">{t('unassigned', { count: unassigned })}</p>
        ) : null}

        <ProposalReview treeSlug={treeSlug} rows={pending.rows} showSubject />
      </div>
    </main>
  );
}
