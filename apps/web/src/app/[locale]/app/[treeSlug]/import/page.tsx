import { notFound } from 'next/navigation';
import { can } from '@chronolignee/domain';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { resolveTreeAccess } from '@/server/access';
import { ImportReview } from '@/components/import/import-review';

/**
 * Dynamic, because it reads the database on every request.
 *
 * Stated rather than inferred: the locale layout declares generateStaticParams,
 * which makes every page under it a prerender candidate, and Next would
 * otherwise try to render this one at build time — against a database the build
 * container does not have.
 */
export const dynamic = 'force-dynamic';

export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/sign-in', locale });

  // Authorisation from the database, not from the presence of a link. A
  // viewer — or a contributor, who adds but never imports — who reaches this
  // URL directly must not get a form the upload would then refuse.
  const access = await resolveTreeAccess(treeSlug);
  if (!access) notFound();
  if (!can(access.role, 'import')) notFound();

  return (
    <main id="main" className="bg-surface-0 min-h-dvh">
      <ImportReview treeSlug={treeSlug} />
    </main>
  );
}
