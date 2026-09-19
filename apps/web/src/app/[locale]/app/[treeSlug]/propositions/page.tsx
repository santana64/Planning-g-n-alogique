import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
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
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">Propositions</h1>
          <p className="text-text-muted max-w-2xl text-sm">
            Des énoncés lus dans vos transcriptions, en attente de votre décision. Chacun montre les
            mots dont il est tiré : c’est eux qu’il faut juger, pas la confiance que le lecteur
            s’accorde. Rien n’entre dans l’arbre sans votre accord, et une proposition rejetée reste
            consultable.
          </p>
          {ai.enabled ? (
            <p className="text-text-faint text-xs">Lecteur configuré : {ai.label}.</p>
          ) : (
            <p className="text-text-faint text-xs">
              La lecture automatique est désactivée sur cette instance.
            </p>
          )}
        </div>

        {unassigned > 0 ? (
          <p className="text-warning text-sm">
            {unassigned === 1
              ? '1 proposition nomme quelqu’un que l’arbre ne permet pas d’identifier sans deviner : dites de qui il s’agit, ou rejetez-la.'
              : `${unassigned} propositions nomment des personnes que l’arbre ne permet pas d’identifier sans deviner : dites de qui il s’agit, ou rejetez-les.`}
          </p>
        ) : null}

        <ProposalReview treeSlug={treeSlug} rows={pending.rows} showSubject />
      </div>
    </main>
  );
}
