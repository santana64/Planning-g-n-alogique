import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { resolveTreeAccess } from '@/server/access';
import { loadTimeline } from '@/server/timeline';
import { TreeNav } from '@/components/people/tree-nav';
import { TimelineView } from '@/components/timeline/timeline-view';

/**
 * Dynamic, because it reads the database on every request.
 *
 * Stated rather than inferred: the locale layout declares generateStaticParams,
 * which makes every page under it a prerender candidate, and Next would
 * otherwise try to render this one at build time — against a database the build
 * container does not have.
 */
export const dynamic = 'force-dynamic';

export default async function ChronologiePage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  const snapshot = await loadTimeline(treeSlug);
  if (!snapshot) notFound();

  const access = await resolveTreeAccess(treeSlug);

  // The same header as every other screen: the timeline was the one view
  // with no way to the others but the browser's back button.
  return (
    <main id="main" className="bg-surface-0 flex h-dvh flex-col">
      <div className="shrink-0 px-6 pt-4">
        <TreeNav
          treeSlug={treeSlug}
          treeName={snapshot.treeName}
          role={access?.role ?? null}
          current="timeline"
        />
      </div>
      <div className="min-h-0 flex-1">
        <TimelineView snapshot={snapshot} />
      </div>
    </main>
  );
}
