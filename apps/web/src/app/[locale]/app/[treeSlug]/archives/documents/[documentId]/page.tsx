import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { TreeNav } from '@/components/people/tree-nav';
import { DocumentStage } from '@/components/viewer/document-stage';
import { TranscriptionEditor } from '@/components/viewer/transcription-editor';
import { Link } from '@/i18n/navigation';
import { isUuid } from '@/lib/ids';
import { loadDocumentView } from '@/server/documents';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

/**
 * Reading a document: the scan on a stage, and beside it what the tree
 * knows about it — its source and call number, the facts that cite it, and
 * its transcription.
 */
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string; documentId: string }>;
}) {
  const { locale, treeSlug, documentId } = await params;
  setRequestLocale(locale);
  if (!isUuid(documentId)) notFound();
  const view = await loadDocumentView(treeSlug, documentId);
  if (!view) notFound();

  const t = await getTranslations('documentView');
  const kinds = await getTranslations('documentView.kinds');
  const format = await getFormatter();
  const { access, document } = view;
  const content = `/api/trees/${treeSlug}/documents/${document.id}/content`;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-8">
      <div className="mx-auto flex max-w-[var(--content-wide,96rem)] flex-col gap-6">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="archive"
        />

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Link
              href={`/app/${treeSlug}/archives`}
              className="text-text-faint hover:text-accent text-xs"
            >
              ← {t('back')}
            </Link>
            <h1 className="font-editorial text-text-primary text-2xl tracking-tight">
              {document.title}
            </h1>
            <p className="text-text-muted text-sm">
              {kinds.has(document.kind) ? kinds(document.kind) : document.kind}
              {' · '}
              {format.number(document.byteSize / 1024 / 1024, { maximumFractionDigits: 1 })} Mo
            </p>
          </div>
          <a
            href={`/api/trees/${treeSlug}/documents/${document.id}`}
            className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)]"
          >
            {t('download')}
          </a>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="h-[72vh] min-h-[28rem]">
            <DocumentStage src={content} mimeType={document.mimeType} title={document.title} />
          </div>

          <aside className="flex flex-col gap-6">
            {document.sourceTitle ? (
              <section className="flex flex-col gap-1">
                <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('source')}</h2>
                <p className="text-text-primary text-sm">{document.sourceTitle}</p>
                {document.repository || document.callNumber ? (
                  <p className="text-text-muted text-xs">
                    {[document.repository, document.callNumber].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="flex flex-col gap-2">
              <h2 className="text-text-faint text-xs tracking-wide uppercase">
                {t('citations', { count: view.citations.length })}
              </h2>
              {view.citations.length === 0 ? (
                <p className="text-text-faint text-sm">{t('noCitation')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {view.citations.map((citation) => (
                    <li
                      key={citation.citationId}
                      className="border-border-subtle rounded-[var(--radius-md)] border px-3 py-2 text-sm"
                    >
                      <p className="text-text-primary">
                        {citation.eventLabel ?? t('claim')}
                        {citation.locator ? (
                          <span className="text-text-faint ml-2 text-xs">{citation.locator}</span>
                        ) : null}
                      </p>
                      {citation.quotation ? (
                        <p className="font-editorial text-text-secondary mt-1 text-[13px] italic">
                          « {citation.quotation} »
                        </p>
                      ) : null}
                      {citation.people.length > 0 ? (
                        <p className="mt-1 flex flex-wrap gap-x-3">
                          {citation.people.map((person) => (
                            <Link
                              key={person.id}
                              href={`/app/${treeSlug}/personnes/${person.id}`}
                              className="text-accent hover:text-accent-hover text-xs"
                            >
                              {person.name}
                            </Link>
                          ))}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {view.pendingProposals ? (
              <Link
                href={`/app/${treeSlug}/propositions`}
                className="border-accent/40 bg-accent/10 text-text-primary hover:bg-accent/15 rounded-[var(--radius-md)] border px-3 py-2 text-sm transition-colors duration-[var(--duration-fast)]"
              >
                {t('proposals', { count: view.pendingProposals })} →
              </Link>
            ) : null}

            <section className="flex flex-col gap-2">
              {access.canEdit ? (
                <TranscriptionEditor
                  treeSlug={treeSlug}
                  documentId={document.id}
                  initial={document.transcription ?? ''}
                />
              ) : (
                <>
                  <h2 className="text-text-faint text-xs tracking-wide uppercase">
                    {t('transcription')}
                  </h2>
                  {document.transcription ? (
                    <p className="font-editorial text-text-secondary text-[15px] leading-7 whitespace-pre-wrap">
                      {document.transcription}
                    </p>
                  ) : (
                    <p className="text-text-faint text-sm">{t('noTranscription')}</p>
                  )}
                </>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
