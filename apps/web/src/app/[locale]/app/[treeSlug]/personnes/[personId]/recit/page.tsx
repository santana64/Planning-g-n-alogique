import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { LineChoice } from '@chronolignee/engine';
import { Link } from '@/i18n/navigation';
import { loadLineageStory } from '@/server/story';
import {
  collectNotes,
  renderStory,
  sourceText,
  type StorySentence,
} from '@/components/story/sentences';
import { StoryPlayer } from '@/components/story/story-player';
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

function Sentences({
  sentences,
  notes,
}: {
  sentences: readonly StorySentence[];
  notes: readonly string[];
}) {
  return (
    <>
      {sentences.map((sentence) => (
        <p key={sentence.text}>
          {sentence.text}
          {sentence.sources.map((source) => (
            <sup key={sourceText(source)} className="text-accent ml-0.5 text-xs">
              {notes.indexOf(sourceText(source)) + 1}
            </sup>
          ))}
          {sentence.factual && sentence.sources.length === 0 ? (
            <span className="text-text-faint ml-2 text-xs">(sans source)</span>
          ) : null}
        </p>
      ))}
    </>
  );
}

const LINES: readonly {
  readonly param: string;
  readonly line: LineChoice;
  readonly label: string;
}[] = [
  { param: 'ancienne', line: 'oldest', label: 'La plus ancienne' },
  { param: 'paternelle', line: 'paternal', label: 'Paternelle' },
  { param: 'maternelle', line: 'maternal', label: 'Maternelle' },
];

export default async function RecitPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string; personId: string }>;
  searchParams: Promise<{ ligne?: string }>;
}) {
  const { locale, treeSlug, personId } = await params;
  setRequestLocale(locale);

  const { ligne } = await searchParams;
  const chosen = LINES.find((entry) => entry.param === ligne) ?? LINES[0];
  if (!chosen) notFound();

  const view = await loadLineageStory(treeSlug, personId, chosen.line);
  if (!view) notFound();

  const chapters = view.plan ? renderStory({ ...view, plan: view.plan }) : [];
  const title = `Remonter la lignée ${view.subjectHidden ? '' : `— ${view.subjectName}`}`.trim();

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={view.access.treeName}
          canEdit={view.access.canEdit}
          current="people"
        />

        <div className="flex flex-col gap-1">
          <Link
            href={`/app/${treeSlug}/personnes/${personId}`}
            className="text-text-faint hover:text-accent text-sm"
          >
            ← {view.subjectName}
          </Link>
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
            Remonter la lignée
          </h1>
          <p className="text-text-muted max-w-2xl text-sm">
            Génération après génération, vers le passé. Chaque phrase vient d’un fait enregistré et
            renvoie à ses sources ; ce qui n’est pas dans l’arbre n’est pas dans le récit.
          </p>
        </div>

        <nav aria-label="Lignée" className="flex items-baseline gap-3">
          <span className="text-text-faint text-xs tracking-wide uppercase">Lignée</span>
          {LINES.map((entry) => (
            <Link
              key={entry.param}
              href={`/app/${treeSlug}/personnes/${personId}/recit?ligne=${entry.param}`}
              aria-current={entry.param === chosen.param ? 'page' : undefined}
              className={
                entry.param === chosen.param
                  ? 'text-text-primary border-accent border-b-2 text-sm'
                  : 'text-text-muted hover:text-text-primary text-sm'
              }
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        {view.subjectHidden ? (
          <p className="border-source/30 bg-source/10 text-source rounded-[var(--radius-md)] border px-4 py-3">
            Cette personne est protégée. Son récit n’est pas affiché : il commencerait par sa propre
            naissance.
          </p>
        ) : (
          <>
            <StoryPlayer chapters={chapters} title={`${title} (${chosen.label.toLowerCase()})`} />

            <ol aria-label="Récit" className="flex flex-col">
              {chapters.map((chapter) => {
                const notes = collectNotes(chapter);
                return (
                  <li
                    key={chapter.key}
                    id={`chapter-${chapter.key}`}
                    className="border-border-subtle grid scroll-mt-6 gap-x-8 gap-y-2 border-t py-6 sm:grid-cols-[8rem_1fr]"
                  >
                    <p className="font-editorial tabular text-accent text-3xl tracking-tight">
                      {chapter.marker ?? ''}
                    </p>
                    <section aria-labelledby={`chapter-title-${chapter.key}`}>
                      <p className="text-text-faint text-xs tracking-wide uppercase">
                        {chapter.eyebrow}
                      </p>
                      <h2
                        id={`chapter-title-${chapter.key}`}
                        className="font-editorial text-text-primary mt-1 text-xl tracking-tight"
                      >
                        {chapter.personId ? (
                          <Link
                            href={`/app/${treeSlug}/personnes/${chapter.personId}`}
                            className="hover:text-accent"
                          >
                            {chapter.title}
                          </Link>
                        ) : (
                          chapter.title
                        )}
                      </h2>
                      <div className="text-text-secondary mt-2 flex flex-col gap-1">
                        <Sentences sentences={chapter.sentences} notes={notes} />
                      </div>
                      {chapter.asides.map((aside) => (
                        <aside
                          key={aside.key}
                          aria-label={aside.eyebrow}
                          className={`mt-4 flex flex-col gap-1 border-l-2 pl-4 text-sm ${
                            aside.kind === 'historical-context'
                              ? 'border-history/50'
                              : 'border-border-strong'
                          }`}
                        >
                          <p className="text-text-faint text-xs tracking-wide uppercase">
                            {aside.eyebrow}
                            {aside.marker ? (
                              <span className="tabular text-history"> · {aside.marker}</span>
                            ) : null}
                          </p>
                          <p className="font-editorial text-text-primary">{aside.title}</p>
                          <div className="text-text-secondary flex flex-col gap-1">
                            <Sentences sentences={aside.sentences} notes={notes} />
                          </div>
                        </aside>
                      ))}
                      {notes.length > 0 ? (
                        <ol
                          aria-label="Sources"
                          className="text-text-muted mt-3 flex flex-col gap-0.5 text-xs"
                        >
                          {notes.map((note, position) => (
                            <li key={note}>
                              <span className="text-accent">{position + 1}</span> {note}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </section>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}
