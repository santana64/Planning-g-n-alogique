import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { loadTimeline } from '@/server/timeline';
import { TimelineView } from '@/components/timeline/timeline-view';

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
