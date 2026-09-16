import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { resolveTreeAccess } from '@/server/access';
import { ImportReview } from '@/components/import/import-review';

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
  // viewer who reaches this URL directly must not get the form.
  const access = await resolveTreeAccess(treeSlug);
  if (!access) notFound();
  if (!access.canEdit) notFound();

  return (
    <main id="main" className="bg-surface-0 min-h-dvh">
      <ImportReview treeSlug={treeSlug} />
    </main>
  );
}
