import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { loadTimeline } from '@/server/timeline';
import { TimelineView } from '@/components/timeline/timeline-view';

/**
 * The public demonstration.
 *
 * No account required — someone deciding whether this product deserves their
 * family's research should be able to see it work first. Living people are
 * still redacted, because the privacy path that protects a real tree has to
 * run here too rather than being bypassed for convenience.
 */
const DEMO_SLUG = 'famille-chassagne-demo';

/**
 * Dynamic, because it reads the database on every request.
 *
 * Stated rather than inferred: the locale layout declares generateStaticParams,
 * which makes every page under it a prerender candidate, and Next would
 * otherwise try to render this one at build time — against a database the build
 * container does not have.
 */
export const dynamic = 'force-dynamic';

export default async function DemoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const snapshot = await loadTimeline(DEMO_SLUG);
  if (!snapshot) notFound();

  return (
    <main id="main" className="bg-surface-0 h-dvh">
      <TimelineView snapshot={snapshot} />
    </main>
  );
}
