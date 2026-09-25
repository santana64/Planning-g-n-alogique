'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ImportAnalysis, ImportProgress } from '@/server/gedcom-import';

/**
 * The import review.
 *
 * An import can add eighteen thousand people to somebody's life's work, and
 * the damage is discovered months later. So the screen between choosing a file
 * and writing it is not a formality: it is the last point at which a person
 * can look at what is about to happen and say no.
 *
 * Everything shown here is measured from the actual file. There is no
 * progress bar driven by a timer, because a progress bar that lies is worse
 * than none — it teaches the user that the numbers on this screen are
 * decoration. The write runs in the worker; the bar is its own count of the
 * rows it has written, read back every second.
 */

type Stage = 'choose' | 'analysing' | 'review' | 'committing' | 'done';

/** How often the page asks where the write stands. */
const POLL_MS = 1_000;
/** Still queued after this long: say so, rather than let the page look stuck. */
const QUEUE_PATIENCE_MS = 15_000;

const ENCODING_LABELS: Record<ImportAnalysis['encoding']['used'], string> = {
  'UTF-8': 'UTF-8',
  'UTF-16LE': 'UTF-16',
  'UTF-16BE': 'UTF-16',
  'WINDOWS-1252': 'Windows-1252',
  MACINTOSH: 'Mac Roman',
  ANSEL: 'ANSEL',
};

export function ImportReview({ treeSlug }: { treeSlug: string }) {
  const t = useTranslations('import');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('choose');
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [waitedLong, setWaitedLong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const jobId = analysis?.jobId ?? null;

  // While the worker writes, ask it how far it has got. A missed answer is
  // simply asked again: the write goes on server-side either way.
  useEffect(() => {
    if (stage !== 'committing' || !jobId || queuedAt === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/trees/${treeSlug}/import/${jobId}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const next = (await response.json()) as ImportProgress;
          if (cancelled) return;
          setProgress(next);
          if (next.state === 'DONE') {
            setStage('done');
            return;
          }
          if (next.state === 'FAILED') {
            setError(next.failure ?? 'WRITE_FAILED');
            setStage('review');
            return;
          }
          if (next.state === 'QUEUED' && Date.now() - (queuedAt ?? 0) > QUEUE_PATIENCE_MS) {
            setWaitedLong(true);
          }
        }
      } catch {
        // Offline for a moment: the next poll tries again.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), POLL_MS);
    }

    timer = setTimeout(() => void poll(), POLL_MS / 2);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stage, jobId, queuedAt, treeSlug]);

  async function handleFile(file: File) {
    setError(null);
    setStage('analysing');

    const body = new FormData();
    body.append('file', file);

    const response = await fetch(`/api/trees/${treeSlug}/import`, { method: 'POST', body });
    const payload = (await response.json()) as ImportAnalysis | { error: string };

    if (!response.ok || 'error' in payload) {
      setError('error' in payload ? payload.error : 'NO_FILE');
      setStage('choose');
      return;
    }

    setAnalysis(payload);
    setStage('review');
  }

  async function handleCommit() {
    if (!analysis) return;
    setError(null);
    setProgress(null);
    setWaitedLong(false);
    setQueuedAt(null);
    setStage('committing');

    const response = await fetch(`/api/trees/${treeSlug}/import/${analysis.jobId}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? 'WRITE_FAILED');
      setStage('review');
      return;
    }
    setQueuedAt(Date.now());
  }

  const writing = progress?.state === 'PROCESSING' && progress.total > 0;
  const percent = writing ? Math.floor((progress.written / progress.total) * 100) : 0;
  const result = progress?.state === 'DONE' ? progress.result : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-editorial text-text-primary text-[length:var(--text-2xl)] tracking-tight">
        {t('title')}
      </h1>

      {error && (
        <p
          role="alert"
          className="text-danger border-danger/30 bg-danger/10 mt-5 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('somethingWrong')}
        </p>
      )}

      {stage === 'choose' && (
        <div className="mt-6">
          <p className="text-text-muted text-sm">{t('nothingWritten')}</p>
          <label
            htmlFor="gedcom-file"
            className="text-text-secondary mt-4 block text-sm font-medium"
          >
            {t('file')}
          </label>
          <input
            ref={inputRef}
            id="gedcom-file"
            type="file"
            accept=".ged,.gedcom,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="border-border-default bg-surface-1 text-text-secondary file:bg-surface-2 file:text-text-primary mt-1.5 w-full rounded-[var(--radius-md)] border px-3 py-2.5 text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:px-3 file:py-1.5"
          />
        </div>
      )}

      {stage === 'analysing' && (
        <p className="text-text-muted mt-6 text-sm" role="status">
          {t('reading')}
        </p>
      )}

      {stage === 'review' && analysis && (
        <ReviewPanel
          analysis={analysis}
          onCommit={handleCommit}
          onCancel={() => setStage('choose')}
        />
      )}

      {stage === 'committing' && (
        <div className="mt-6 flex flex-col gap-3">
          {/* The phase alone is announced; the percentage would be read out
              every second. The bar carries the number for whoever asks. */}
          <p className="text-text-muted text-sm" role="status">
            {progress?.state === 'PROCESSING' ? t('writing') : t('queued')}
          </p>
          {writing ? (
            <div className="flex items-center gap-3">
              <progress
                value={progress.written}
                max={progress.total}
                aria-label={t('writingLabel')}
                className="[&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent h-1.5 w-full overflow-hidden rounded-full"
              />
              <span className="text-text-secondary tabular w-12 shrink-0 text-right text-sm">
                {t('percent', { percent })}
              </span>
            </div>
          ) : null}
          {waitedLong ? <p className="text-text-faint text-sm">{t('queueSlow')}</p> : null}
        </div>
      )}

      {stage === 'done' && result && (
        <div className="mt-6" role="status">
          <p className="font-editorial text-text-primary text-lg">
            {t('peopleAdded', { count: result.people })}
          </p>
          <p className="text-text-muted mt-1 text-sm">
            {t('relationshipsRestored', { count: result.relationships })}
            {result.rejected > 0 ? t('rejected', { count: result.rejected }) : ''}
          </p>
          <button
            type="button"
            onClick={() =>
              startTransition(() => {
                router.push(`/app/${treeSlug}/chronologie`);
                router.refresh();
              })
            }
            className="bg-accent text-accent-contrast hover:bg-accent-hover mt-5 rounded-[var(--radius-md)] px-5 py-2.5 font-medium transition-colors duration-[var(--duration-fast)]"
          >
            {t('exploreTimeline')}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewPanel({
  analysis,
  onCommit,
  onCancel,
}: {
  analysis: ImportAnalysis;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('import');
  const { counts } = analysis;

  return (
    <div className="mt-6">
      <p className="text-text-muted text-sm">
        {t('fileLine', {
          filename: analysis.filename,
          size: (analysis.byteSize / 1024).toFixed(0),
        })}
        {analysis.detectedVersion ? t('version', { version: analysis.detectedVersion }) : ''}
        {analysis.generator ? t('producedBy', { generator: analysis.generator }) : ''}
        {t('encoding', { encoding: ENCODING_LABELS[analysis.encoding.used] })}
        {analysis.encoding.declared &&
        analysis.encoding.declared.toUpperCase() !== analysis.encoding.used
          ? t('declaredAs', { declared: analysis.encoding.declared })
          : ''}
      </p>

      {analysis.encoding.guessed && (
        <p className="text-approximate mt-3 text-sm">
          {t('encodingGuessed', { encoding: ENCODING_LABELS[analysis.encoding.used] })}
        </p>
      )}

      {analysis.sampleNames.length > 0 && (
        <p className="text-text-secondary mt-3 text-sm">
          <span className="text-text-faint">{t('sampleNames')}</span>
          {analysis.sampleNames.join(' · ')}
        </p>
      )}

      <dl className="border-border-subtle bg-border-subtle mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border sm:grid-cols-4">
        <Count label={t('counts.people')} value={counts.people} />
        <Count label={t('counts.families')} value={counts.families} />
        <Count label={t('counts.events')} value={counts.events} />
        <Count label={t('counts.relationships')} value={counts.relationships} />
        <Count label={t('counts.places')} value={counts.places} />
        <Count label={t('counts.sources')} value={counts.sources} />
        <Count label={t('counts.media')} value={counts.media} />
        <Count label={t('counts.unparseableDates')} value={counts.unparseableDates} muted />
      </dl>

      {counts.unparseableDates > 0 && (
        <p className="text-text-muted mt-3 text-sm">{t('unparseableDatesNote')}</p>
      )}

      {analysis.unknownTags.length > 0 && (
        <section className="mt-6">
          <h2 className="text-text-secondary text-sm font-medium">
            {t('unknownTags', { count: analysis.unknownTags.length })}
          </h2>
          <p className="text-text-faint mt-1 text-xs">{t('unknownTagsNote')}</p>
          <p className="text-text-muted mt-2 font-mono text-xs">
            {analysis.unknownTags.join(' · ')}
          </p>
        </section>
      )}

      {analysis.warnings.length > 0 && (
        <section className="mt-6">
          <h2 className="text-text-secondary text-sm font-medium">
            {t('warnings', { count: analysis.warnings.length })}
          </h2>
          <p className="text-text-faint mt-1 text-xs">{t('warningsNote')}</p>
          <ul className="border-border-subtle mt-2 max-h-64 divide-y divide-[var(--border-subtle)] overflow-auto rounded-[var(--radius-md)] border">
            {analysis.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex gap-3 px-3 py-1.5 text-sm">
                <span className="text-text-faint tabular w-12 shrink-0 text-right text-xs">
                  {warning.lineNumber > 0 ? `l.${warning.lineNumber}` : '—'}
                </span>
                <span className="text-text-secondary">
                  {t.has(`warningLabels.${warning.code}`)
                    ? t(`warningLabels.${warning.code}`)
                    : warning.code}
                </span>
                <span className="text-text-faint truncate text-xs">{warning.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.fileIssues.length > 0 && (
        <section className="mt-6">
          <h2 className="text-text-secondary text-sm font-medium">
            {t('malformedLines', { count: analysis.fileIssues.length })}
          </h2>
          <p className="text-text-faint mt-1 text-xs">{t('malformedNote')}</p>
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCommit}
          className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-5 py-2.5 font-medium transition-colors duration-[var(--duration-fast)]"
        >
          {t('import', { count: counts.people })}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-text-muted hover:text-text-primary text-sm underline underline-offset-2"
        >
          {t('chooseAnother')}
        </button>
      </div>
    </div>
  );
}

function Count({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  const format = useFormatter();
  return (
    <div className="bg-surface-1 px-4 py-3">
      <dd
        className={`tabular font-editorial text-xl ${muted && value > 0 ? 'text-approximate' : 'text-text-primary'}`}
      >
        {format.number(value)}
      </dd>
      <dt className="text-text-faint mt-0.5 text-xs">{label}</dt>
    </div>
  );
}
