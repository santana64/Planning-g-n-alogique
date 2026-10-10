import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TreeNav } from '@/components/people/tree-nav';
import { PhotoUpload } from '@/components/photos/photo-upload';
import { Link } from '@/i18n/navigation';
import { loadGallery } from '@/server/media';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

/**
 * The family album: every photograph this reader may see, in a wall that
 * keeps each picture's own proportions, with who is in it on hover.
 */
export default async function PhotosPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('photos');
  const gallery = await loadGallery(treeSlug);
  if (!gallery) notFound();
  const { access, photos } = gallery;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="photos"
        />

        <div className="rise flex flex-col gap-2">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-2xl text-sm">{t('lead')}</p>
        </div>

        {access.canEdit ? <PhotoUpload treeSlug={treeSlug} /> : null}

        {photos.length === 0 ? (
          <p className="text-text-muted text-sm">{t('empty')}</p>
        ) : (
          <ul className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>li]:mb-3">
            {photos.map((photo, index) => (
              <li key={photo.mediaId} className="break-inside-avoid">
                <Link
                  href={`/app/${treeSlug}/photos/${photo.mediaId}`}
                  className="research-row group border-border-subtle bg-surface-sunken relative block overflow-hidden rounded-[var(--radius-lg)] border"
                  style={{ animationDelay: `${Math.min(index, 16) * 30}ms` }}
                >
                  {photo.processed || access.role !== null ? (
                    <img
                      src={`/api/trees/${treeSlug}/media/${photo.mediaId}?variant=thumbnail`}
                      alt={photo.title}
                      loading="lazy"
                      width={photo.width ?? undefined}
                      height={photo.height ?? undefined}
                      className="block h-auto w-full transition-transform duration-[var(--duration-slow)] group-hover:scale-[1.04]"
                    />
                  ) : (
                    <span className="text-text-faint flex aspect-[4/3] items-center justify-center text-xs">
                      {t('processing')}
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pt-8 pb-2.5 text-white opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="font-editorial text-sm">{photo.title}</span>
                    {photo.captured ? (
                      <span className="text-xs opacity-80">{photo.captured}</span>
                    ) : null}
                    {photo.tagged.length > 0 ? (
                      <span className="text-xs opacity-90">{photo.tagged.join(', ')}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
