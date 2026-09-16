import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { loadTimeline } from '@/server/timeline';
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

  return (
    <main id="main" className="bg-surface-0 h-dvh">
      <TimelineView snapshot={snapshot} />
    </main>
  );
}
