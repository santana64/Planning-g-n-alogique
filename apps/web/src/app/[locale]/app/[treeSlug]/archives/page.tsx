import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { loadArchive, loadDocuments } from '@/server/archive';
import { DocumentUpload } from '@/components/archive/document-upload';
import { SourceForm } from '@/components/archive/source-form';
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

type Sized = (key: string, values: { size: string | number }) => string;

/** The unit belongs to the language; the arithmetic does not. */
function formatBytes(t: Sized, bytes: number): string {
  if (bytes < 1024) return t('bytes', { size: bytes });
  if (bytes < 1024 * 1024) return t('kilobytes', { size: Math.round(bytes / 1024) });
  return t('megabytes', { size: (bytes / (1024 * 1024)).toFixed(1) });
}

export default async function ArchivesPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('archive');
  const [archive, documents] = await Promise.all([loadArchive(treeSlug), loadDocuments(treeSlug)]);
  if (!archive || !documents) notFound();

  const { access } = archive;
  const totalEvents = archive.citedEventCount + archive.uncitedEventCount;
  const citedShare =
    totalEvents === 0 ? 0 : Math.round((archive.citedEventCount / totalEvents) * 100);

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="archive"
        />

        <div className="flex flex-col gap-1">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted text-sm">{t('lead')}</p>
        </div>

        {/* The number that says what this tree is worth. A genealogy where
         * nothing is cited is a family story — a fine thing to have, and not
         * the same thing as research. Software that never shows this lets the
         * difference blur. */}
        <section className="border-border-subtle flex flex-wrap items-baseline gap-8 rounded-[var(--radius-lg)] border px-5 py-4">
          <p className="flex flex-col">
            <span className="font-editorial text-text-primary text-2xl">{citedShare} %</span>
            <span className="text-text-faint text-xs">{t('citedShare')}</span>
          </p>
          <p className="flex flex-col">
            <span className="font-editorial text-text-primary text-2xl">
              {archive.citedEventCount}
            </span>
            <span className="text-text-faint text-xs">{t('citedEvents')}</span>
          </p>
          <p className="flex flex-col">
            <span className="font-editorial text-warning text-2xl">
              {archive.uncitedEventCount}
            </span>
            <span className="text-text-faint text-xs">{t('uncitedEvents')}</span>
          </p>
          <p className="flex flex-col">
            <span className="font-editorial text-text-primary text-2xl">
              {archive.sources.length}
            </span>
            <span className="text-text-faint text-xs">
              {t('sourceCount', { count: archive.sources.length })}
            </span>
          </p>
          <p className="flex flex-col">
            <span className="font-editorial text-text-primary text-2xl">
              {archive.documentCount}
            </span>
            <span className="text-text-faint text-xs">
              {t('documentCount', { count: archive.documentCount })}
            </span>
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('sources')}</h2>
          {archive.sources.length === 0 ? (
            <p className="text-text-muted text-sm">{t('noSources')}</p>
          ) : (
            <ul className="flex flex-col">
              {archive.sources.map((source) => (
                <li
                  key={source.sourceId}
                  className="border-border-subtle flex flex-wrap items-baseline justify-between gap-3 border-b py-3 last:border-b-0"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-editorial text-text-primary text-base">
                      {source.title}
                    </span>
                    <span className="text-text-faint flex flex-wrap gap-3 text-xs">
                      <span>{t(`sourceTypes.${source.type}`)}</span>
                      {source.callNumber ? (
                        <span className="text-source">
                          {t('callNumberOf', { callNumber: source.callNumber })}
                        </span>
                      ) : null}
                      {source.repository ? <span>{source.repository}</span> : null}
                      <span>{t(`reliabilityShort.${source.reliability}`)}</span>
                    </span>
                  </span>
                  <span className="text-text-muted tabular text-sm">
                    {t('citationsCount', { count: source.citationCount })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {access.canEdit ? <SourceForm treeSlug={treeSlug} /> : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('documents')}</h2>
          {documents.documents.length === 0 ? (
            <p className="text-text-muted text-sm">{t('noDocuments')}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documents.documents.map((document) => (
                <li
                  key={document.documentId}
                  className="border-border-subtle flex flex-col gap-1 rounded-[var(--radius-md)] border p-3"
                >
                  <a
                    href={`/api/trees/${treeSlug}/documents/${document.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-text-primary hover:text-accent font-editorial text-sm"
                  >
                    {document.title}
                  </a>
                  <span className="text-text-faint flex flex-wrap gap-2 text-xs">
                    <span>{formatBytes(t, document.byteSize)}</span>
                    <span>{document.mimeType}</span>
                    {document.sourceTitle ? <span>{document.sourceTitle}</span> : null}
                  </span>
                  {document.citationCount === 0 ? (
                    // A document nobody cites supports nothing. Not an error,
                    // but the researcher should be able to see it at a glance.
                    <span className="text-text-faint text-xs italic">{t('citedNowhere')}</span>
                  ) : (
                    <span className="text-text-muted text-xs">
                      {t('citationsCount', { count: document.citationCount })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {access.canEdit ? <DocumentUpload treeSlug={treeSlug} /> : null}
      </div>
    </main>
  );
}
