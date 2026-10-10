import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TreeNav } from '@/components/people/tree-nav';
import { PhotoDetailsForm } from '@/components/photos/photo-details';
import { PhotoTagger } from '@/components/photos/photo-tagger';
import { Link } from '@/i18n/navigation';
import { isUuid } from '@/lib/ids';
import { loadPhoto } from '@/server/media';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string; mediaId: string }>;
}) {
  const { locale, treeSlug, mediaId } = await params;
  setRequestLocale(locale);
  if (!isUuid(mediaId)) notFound();
  const loaded = await loadPhoto(treeSlug, mediaId);
  if (!loaded) notFound();
  const t = await getTranslations('photos');
  const { access, photo, people } = loaded;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-8">
      <div className="mx-auto flex max-w-[var(--content-wide,96rem)] flex-col gap-6">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="photos"
        />

        <div className="flex flex-col gap-1">
          <Link
            href={`/app/${treeSlug}/photos`}
            className="text-text-faint hover:text-accent text-xs"
          >
            ← {t('back')}
          </Link>
          <h1 className="font-editorial text-text-primary text-2xl tracking-tight">
            {photo.title}
          </h1>
          <p className="text-text-muted text-sm">
            {[photo.captured, photo.copyright].filter(Boolean).join(' · ')}
          </p>
          {photo.description ? (
            <p className="text-text-secondary mt-1 max-w-3xl text-sm">{photo.description}</p>
          ) : null}
        </div>

        <PhotoTagger
          treeSlug={treeSlug}
          mediaId={photo.mediaId}
          title={photo.title}
          width={photo.width}
          height={photo.height}
          tags={photo.tags}
          people={people}
          canEdit={access.canEdit}
        />

        {access.canEdit ? (
          <PhotoDetailsForm
            treeSlug={treeSlug}
            mediaId={photo.mediaId}
            title={photo.title === photo.originalFilename ? '' : photo.title}
            captured={photo.capturedOriginalText ?? ''}
            description={photo.description ?? ''}
            copyright={photo.copyright ?? ''}
          />
        ) : null}

        <p className="text-text-faint text-xs">{t('noRecognition')}</p>
      </div>
    </main>
  );
}
