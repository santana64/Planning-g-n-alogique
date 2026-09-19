import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { features } from '@/lib/env';
import { getAIProvider } from '@/server/ai';
import { loadStorySuggestions } from '@/server/story';
import { StorySuggestions } from '@/components/story/story-suggestions';
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

export default async function RecitsPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  if (!features.storyDirector) notFound();

  const view = await loadStorySuggestions(treeSlug);
  if (!view) notFound();

  const provider = view.access.canEdit ? getAIProvider() : null;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={view.access.treeName}
          role={view.access.role}
          current="stories"
        />

        <div className="flex flex-col gap-1">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
            Récits suggérés
          </h1>
          <p className="text-text-muted max-w-2xl text-sm">
            Des histoires que l’arbre contient déjà : un long déplacement, la lignée qui remonte le
            plus loin, une vie bien documentée, quatre générations en vie en même temps. Chaque
            récit est raconté à partir des données, sources à l’appui ; les personnes vivantes n’en
            font jamais partie.
          </p>
        </div>

        {view.suggestions.length === 0 ? (
          <p className="border-border-subtle text-text-muted rounded-[var(--radius-lg)] border border-dashed p-8">
            Pas encore assez de données pour un récit : il faut au moins une lignée de trois
            générations, un déplacement entre deux lieux géolocalisés ou une vie dont plusieurs
            événements sont sourcés.
          </p>
        ) : (
          <StorySuggestions
            treeSlug={treeSlug}
            suggestions={view.suggestions}
            rulesChoice={view.rulesChoice}
            provider={
              provider ? { label: provider.label, external: provider.sendsDataExternally } : null
            }
          />
        )}
      </div>
    </main>
  );
}
