'use client';

import { useRef, useState } from 'react';
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

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Connectez-vous pour verser un document.',
  NOT_FOUND: "Cet arbre n'existe pas ou ne vous est pas ouvert en écriture.",
  NO_FILE: 'Aucun fichier sélectionné.',
  EMPTY: 'Fichier vide.',
  TOO_LARGE: 'Fichier trop volumineux : 25 Mo au maximum.',
  UNRECOGNISED_TYPE:
    "Ce fichier n'a pas été reconnu : les premiers octets ne disent rien de connu.",
  DISALLOWED_TYPE: 'Ce type de fichier n’est pas accepté ici.',
  EXTENSION_MISMATCH: 'Le contenu du fichier ne correspond pas à son extension.',
  SOURCE_NOT_FOUND: 'La source choisie est introuvable.',
  WRITE_FAILED: "Le document n'a pas pu être enregistré.",
};

type Stage = 'idle' | 'sending' | 'done';

export function DocumentUpload({ treeSlug }: { treeSlug: string }) {
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
      setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES['WRITE_FAILED'] ?? 'Échec.');
      setStage('idle');
      return;
    }

    setMessage(
      payload.duplicate
        ? // Deduplicated by content. Told plainly, because silently doing
          // nothing looks like a failed upload.
          `Ce document est déjà dans l’archive${payload.title ? ` sous « ${payload.title} »` : ''}.`
        : 'Document versé.',
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
          setError(ERROR_MESSAGES['NO_FILE'] ?? null);
          return;
        }
        const title = (new FormData(form).get('title') as string | null)?.trim() ?? '';
        void send(file, title);
      }}
      className="border-border-subtle bg-surface-1/40 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
    >
      <h2 className="font-editorial text-text-primary text-base">Verser un document</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-file" className="text-text-secondary text-sm font-medium">
            Fichier
          </label>
          <input
            ref={inputRef}
            id="doc-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/tiff,application/pdf"
            className="text-text-secondary file:border-border-default file:bg-surface-2 file:text-text-primary text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-text-faint text-xs">
            Photo ou scan d’acte, PDF. 25 Mo au maximum. Le contenu est vérifié, pas l’extension.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="doc-title" className="text-text-secondary text-sm font-medium">
            Titre
          </label>
          <input
            id="doc-title"
            name="title"
            placeholder="Acte de naissance de Jean-Baptiste, 1822"
            className="border-border-default bg-surface-1 text-text-primary placeholder:text-text-faint focus:border-accent rounded-[var(--radius-md)] border px-3 py-2 focus:outline-none"
          />
          <p className="text-text-faint text-xs">
            À défaut, le nom du fichier est repris tel quel.
          </p>
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
        {stage === 'sending' ? 'Envoi…' : 'Verser'}
      </button>
    </form>
  );
}
