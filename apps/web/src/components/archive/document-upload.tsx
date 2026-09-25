'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/**
 * Putting a document into the archive.
 *
 * The file goes to a route rather than a Server Action: a scan is megabytes,
 * and a Server Action serialises its arguments through the RSC payload, which
 * is the wrong pipe for that.
 *
 * Nothing the browser says about the file is believed. The route reads the
 * first bytes and decides for itself what this is; the name is kept only as a
 * label, never as a storage key.
 */

type Stage = 'idle' | 'sending' | 'done';

export function DocumentUpload({ treeSlug }: { treeSlug: string }) {
  const t = useTranslations('archive.upload');
  const errors = useTranslations('archive.uploadErrors');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File, title: string) {
    setStage('sending');
    setError(null);
    setMessage(null);

    const body = new FormData();
    body.append('file', file);
    if (title) body.append('title', title);

    const response = await fetch(`/api/trees/${treeSlug}/documents`, { method: 'POST', body });
    const payload = (await response.json()) as
      { documentId: string; duplicate: boolean; title?: string } | { error: string };

    if (!response.ok || 'error' in payload) {
      const code = 'error' in payload ? payload.error : 'WRITE_FAILED';
      setError(errors.has(code) ? errors(code) : errors('WRITE_FAILED'));
      setStage('idle');
      return;
    }

    setMessage(
      payload.duplicate
        ? // Deduplicated by content. Told plainly, because silently doing
          // nothing looks like a failed upload.
          payload.title
          ? t('alreadyFiledTitled', { title: payload.title })
          : t('alreadyFiled')
        : t('done'),
    );
    setStage('done');
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const file = inputRef.current?.files?.[0];
        if (!file) {
          setError(errors('NO_FILE'));
          return;
        }
        const title = (new FormData(form).get('title') as string | null)?.trim() ?? '';
        void send(file, title);
      }}
      className="border-border-subtle bg-surface-1/40 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
    >
      <h2 className="font-editorial text-text-primary text-base">{t('heading')}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-file" className="text-text-secondary text-sm font-medium">
            {t('file')}
          </label>
          <input
            ref={inputRef}
            id="doc-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/tiff,application/pdf"
            className="text-text-secondary file:border-border-default file:bg-surface-2 file:text-text-primary text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-text-faint text-xs">{t('fileHint')}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-title" className="text-text-secondary text-sm font-medium">
            {t('title')}
          </label>
          <input
            id="doc-title"
            name="title"
            placeholder={t('titlePlaceholder')}
            className="border-border-default bg-surface-1 text-text-primary placeholder:text-text-faint focus:border-accent rounded-[var(--radius-md)] border px-3 py-2 focus:outline-none"
          />
          <p className="text-text-faint text-xs">{t('titleHint')}</p>
        </div>
      </div>

      {error ? (
        <p
          role="status"
          className="text-danger border-danger/30 bg-danger/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="text-success border-success/30 bg-success/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={stage === 'sending'}
        className="bg-accent text-accent-contrast hover:bg-accent-hover self-start rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {stage === 'sending' ? t('sending') : t('submit')}
      </button>
    </form>
  );
}
