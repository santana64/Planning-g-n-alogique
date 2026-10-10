'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/**
 * Adding photographs: dropped, pasted from a folder, or chosen.
 *
 * Several at once, each with its own progress bar — a shoebox of fifty
 * scans is the normal case — sent one after another so a slow connection
 * gives steady progress instead of fifty stalled bars.
 */

interface Item {
  readonly id: string;
  readonly name: string;
  progress: number;
  status: 'waiting' | 'sending' | 'done' | 'duplicate' | 'error';
  error?: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/tiff';

function send(
  treeSlug: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ ok: boolean; status: number; body: { error?: string; duplicate?: boolean } }> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/trees/${treeSlug}/media`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let body: { error?: string; duplicate?: boolean } = {};
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {
        // Not JSON: treated as a failure below.
      }
      resolve({ ok: request.status >= 200 && request.status < 300, status: request.status, body });
    };
    request.onerror = () => resolve({ ok: false, status: 0, body: { error: 'NETWORK' } });
    const form = new FormData();
    form.append('file', file);
    request.send(form);
  });
}

export function PhotoUpload({ treeSlug }: { treeSlug: string }) {
  const t = useTranslations('photos.upload');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (id: string, patch: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const upload = async (files: readonly File[]) => {
    if (files.length === 0) return;
    const batch = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      status: 'waiting' as const,
      file,
    }));
    setItems((current) => [...batch.map(({ file: _file, ...item }) => item), ...current]);
    setBusy(true);
    for (const entry of batch) {
      update(entry.id, { status: 'sending' });
      const result = await send(treeSlug, entry.file, (progress) => update(entry.id, { progress }));
      if (result.ok) {
        update(entry.id, { progress: 1, status: result.body.duplicate ? 'duplicate' : 'done' });
      } else {
        const code = result.body.error ?? 'UNKNOWN';
        update(entry.id, {
          status: 'error',
          error: t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.UNKNOWN'),
        });
      }
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void upload([...event.dataTransfer.files]);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed px-6 py-8 text-center transition-colors duration-[var(--duration-fast)] ${
          over ? 'border-accent bg-accent/10' : 'border-border-default bg-surface-1/40'
        }`}
      >
        <span aria-hidden="true" className="text-accent text-3xl">
          ⌬
        </span>
        <p className="text-text-primary text-sm">{t('drop')}</p>
        <p className="text-text-faint text-xs">{t('formats')}</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="bg-accent text-accent-contrast hover:bg-accent-hover mt-1 rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)] disabled:opacity-60"
        >
          {t('choose')}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          aria-label={t('choose')}
          className="sr-only"
          onChange={(event) => {
            void upload([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <p className="text-text-faint max-w-md text-xs">{t('privacy')}</p>
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-live="polite">
          {items.map((item) => (
            <li key={item.id} className="grid grid-cols-[1fr_8rem_auto] items-center gap-3 text-xs">
              <span className="text-text-secondary truncate">{item.name}</span>
              <span className="bg-surface-2 h-1.5 overflow-hidden rounded-full">
                <span
                  className={`block h-full rounded-full transition-[width] duration-200 ${
                    item.status === 'error' ? 'bg-danger' : 'bg-accent'
                  }`}
                  style={{ width: `${Math.round(item.progress * 100)}%` }}
                />
              </span>
              <span className={item.status === 'error' ? 'text-danger' : 'text-text-faint'}>
                {item.status === 'error' ? item.error : t(`status.${item.status}`)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
