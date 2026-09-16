import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { resolveTreeAccess } from '@/server/access';
import { PersonForm } from '@/components/people/person-form';
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

export default async function NewPersonPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const access = await resolveTreeAccess(treeSlug);
  // Not rendering the form is not the guard — the action checks again. This
  // only spares a visitor a form they would not be allowed to submit.
  if (!access || !access.canEdit) notFound();

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          canEdit={access.canEdit}
          current="people"
        />

        <div className="flex flex-col gap-1">
          <Link
            href={`/app/${treeSlug}/personnes`}
            className="text-text-faint hover:text-accent text-sm"
          >
            ← Toutes les personnes
          </Link>
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
            Nouvelle personne
          </h1>
          <p className="text-text-muted text-sm">
            Seul un nom est obligatoire. Tout le reste peut arriver plus tard, y compris des dates
            que l’on ne sait pas encore lire.
          </p>
        </div>

        <PersonForm treeSlug={treeSlug} person={null} />
      </div>
    </main>
  );
}
