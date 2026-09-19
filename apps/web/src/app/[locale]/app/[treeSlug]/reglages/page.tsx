import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { DeleteTree } from '@/components/settings/delete-tree';
import { TreeSettingsForm } from '@/components/settings/tree-settings-form';
import { TreeNav } from '@/components/people/tree-nav';
import { loadTreeSettings } from '@/server/settings';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

export default async function TreeSettingsPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const view = await loadTreeSettings(treeSlug);
  if (!view) notFound();
  const { access } = view;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-10">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="settings"
        />

        <h1 className="font-editorial text-text-primary text-3xl tracking-tight">Réglages</h1>

        {view.canManage ? (
          <section aria-labelledby="settings-heading" className="flex max-w-2xl flex-col gap-4">
            <h2 id="settings-heading" className="text-text-faint text-xs tracking-wide uppercase">
              L’arbre et ses visiteurs
            </h2>
            <TreeSettingsForm treeSlug={treeSlug} settings={view.settings} />
          </section>
        ) : null}

        {view.canExport ? (
          <section aria-labelledby="export-heading" className="flex max-w-2xl flex-col gap-3">
            <h2 id="export-heading" className="text-text-faint text-xs tracking-wide uppercase">
              Emporter l’arbre
            </h2>
            <p className="text-text-secondary text-sm">
              Un fichier GEDCOM 7 que tout logiciel de généalogie sait lire : personnes, noms,
              événements avec leurs dates telles qu’enregistrées, liens et sources. Il contient
              aussi les personnes vivantes, sans masque : gardez-le comme vous garderiez l’arbre.
              Chaque export est inscrit à l’historique.
            </p>
            {/* A plain anchor: a prefetching link would record exports nobody asked for. */}
            <a
              href={`/api/trees/${treeSlug}/export`}
              download
              className="text-accent self-start text-sm underline underline-offset-2"
            >
              Télécharger le fichier GEDCOM
            </a>
          </section>
        ) : null}

        {view.canDelete ? (
          <section
            aria-labelledby="delete-heading"
            className="border-danger/30 flex max-w-2xl flex-col gap-3 rounded-[var(--radius-lg)] border p-5"
          >
            <h2 id="delete-heading" className="text-danger text-xs tracking-wide uppercase">
              Supprimer l’arbre
            </h2>
            <DeleteTree treeSlug={treeSlug} treeName={view.settings.name} counts={view.counts} />
          </section>
        ) : null}
      </div>
    </main>
  );
}
