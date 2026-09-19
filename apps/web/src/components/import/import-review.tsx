'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { ImportAnalysis } from '@/server/gedcom-import';

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
 * decoration.
 */

type Stage = 'choose' | 'analysing' | 'review' | 'committing' | 'done';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "Cet arbre n'existe pas ou ne vous est pas accessible.",
  FORBIDDEN: "Vous n'avez pas le droit de modifier cet arbre.",
  TOO_LARGE: 'Fichier trop volumineux.',
  NOT_GEDCOM: "Ce fichier ne commence pas par « 0 HEAD » : ce n'est pas un GEDCOM.",
  EMPTY: 'Fichier vide.',
  NO_FILE: 'Aucun fichier sélectionné.',
  ALREADY_COMMITTED: 'Cet import a déjà été appliqué.',
  FILE_MISSING: "Le fichier d'origine est introuvable. Recommencez l'import.",
  UNAUTHENTICATED: 'Connectez-vous pour importer un fichier.',
};

const WARNING_LABELS: Record<string, string> = {
  UNPARSEABLE_DATE: 'Date illisible, conservée telle quelle',
  DANGLING_POINTER: 'Référence vers une fiche absente du fichier',
  PERSON_WITHOUT_NAME: 'Personne sans nom',
  FAMILY_WITHOUT_MEMBERS: 'Famille sans membre',
  CHILD_IS_OWN_PARENT: 'Enfant déclaré comme son propre parent',
  SELF_UNION: 'Personne déclarée unie à elle-même : union ignorée',
  UNION_DATES_REVERSED: 'Divorce daté avant le mariage : union importée sans ses dates',
  DUPLICATE_RELATIONSHIP: 'Relation déclarée deux fois',
  UNHANDLED_RECORD: 'Type de fiche non traité',
  AMBIGUOUS_NAME: 'Nom ambigu',
};

export function ImportReview({ treeSlug }: { treeSlug: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('choose');
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [summary, setSummary] = useState<{ people: number; relationships: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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
    setStage('committing');

    const response = await fetch(`/api/trees/${treeSlug}/import/${analysis.jobId}`, {
      method: 'POST',
    });
    const payload = (await response.json()) as
      { people: number; relationships: number } | { error: string };

    if (!response.ok || 'error' in payload) {
      setError('error' in payload ? payload.error : 'NO_FILE');
      setStage('review');
      return;
    }

    setSummary(payload);
    setStage('done');
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-editorial text-text-primary text-[length:var(--text-2xl)] tracking-tight">
        Importer un fichier GEDCOM
      </h1>

      {error && (
        <p
          role="alert"
          className="text-danger border-danger/30 bg-danger/10 mt-5 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {ERROR_MESSAGES[error] ?? "Une erreur est survenue pendant l'import."}
        </p>
      )}

      {stage === 'choose' && (
        <div className="mt-6">
          <p className="text-text-muted text-sm">
            Rien ne sera écrit dans votre arbre avant que vous ayez vu ce que contient le fichier.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".ged,.gedcom,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="border-border-default bg-surface-1 text-text-secondary file:bg-surface-2 file:text-text-primary mt-4 w-full rounded-[var(--radius-md)] border px-3 py-2.5 text-sm file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:px-3 file:py-1.5"
          />
        </div>
      )}

      {stage === 'analysing' && (
        <p className="text-text-muted mt-6 text-sm" role="status">
          Lecture du fichier…
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
        <p className="text-text-muted mt-6 text-sm" role="status">
          Écriture dans l&apos;arbre…
        </p>
      )}

      {stage === 'done' && summary && (
        <div className="mt-6" role="status">
          <p className="font-editorial text-text-primary text-lg">
            {summary.people} personnes ajoutées.
          </p>
          <p className="text-text-muted mt-1 text-sm">
            {summary.relationships} relations rétablies.
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
            Explorer la chronologie
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
  const { counts } = analysis;

  return (
    <div className="mt-6">
      <p className="text-text-muted text-sm">
        {analysis.filename} · {(analysis.byteSize / 1024).toFixed(0)} Ko
        {analysis.detectedVersion && ` · GEDCOM ${analysis.detectedVersion}`}
        {analysis.generator && ` · produit par ${analysis.generator}`}
      </p>

      <dl className="border-border-subtle bg-border-subtle mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border sm:grid-cols-4">
        <Count label="personnes" value={counts.people} />
        <Count label="familles" value={counts.families} />
        <Count label="événements" value={counts.events} />
        <Count label="relations" value={counts.relationships} />
        <Count label="lieux" value={counts.places} />
        <Count label="sources" value={counts.sources} />
        <Count label="médias" value={counts.media} />
        <Count label="dates illisibles" value={counts.unparseableDates} muted />
      </dl>

      {counts.unparseableDates > 0 && (
        <p className="text-text-muted mt-3 text-sm">
          Les dates illisibles sont conservées telles qu&apos;écrites dans le fichier. Elles
          n&apos;auront pas de position sur la chronologie tant que personne ne les aura
          interprétées — plutôt qu&apos;une position inventée.
        </p>
      )}

      {analysis.unknownTags.length > 0 && (
        <section className="mt-6">
          <h2 className="text-text-secondary text-sm font-medium">
            Balises non interprétées ({analysis.unknownTags.length})
          </h2>
          <p className="text-text-faint mt-1 text-xs">
            Conservées dans le fichier d&apos;origine, qui reste téléchargeable.
          </p>
          <p className="text-text-muted mt-2 font-mono text-xs">
            {analysis.unknownTags.join(' · ')}
          </p>
        </section>
      )}

      {analysis.warnings.length > 0 && (
        <section className="mt-6">
          <h2 className="text-text-secondary text-sm font-medium">
            Avertissements ({analysis.warnings.length})
          </h2>
          <p className="text-text-faint mt-1 text-xs">
            Aucun ne bloque l&apos;import. Ce sont des points à vérifier ensuite.
          </p>
          <ul className="border-border-subtle mt-2 max-h-64 divide-y divide-[var(--border-subtle)] overflow-auto rounded-[var(--radius-md)] border">
            {analysis.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex gap-3 px-3 py-1.5 text-sm">
                <span className="text-text-faint tabular w-12 shrink-0 text-right text-xs">
                  {warning.lineNumber > 0 ? `l.${warning.lineNumber}` : '—'}
                </span>
                <span className="text-text-secondary">
                  {WARNING_LABELS[warning.code] ?? warning.code}
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
            Lignes mal formées ({analysis.fileIssues.length})
          </h2>
          <p className="text-text-faint mt-1 text-xs">
            Le fichier a été lu malgré elles. Les numéros de ligne renvoient au fichier
            d&apos;origine.
          </p>
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCommit}
          className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-5 py-2.5 font-medium transition-colors duration-[var(--duration-fast)]"
        >
          Importer {counts.people} personnes
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-text-muted hover:text-text-primary text-sm underline underline-offset-2"
        >
          Choisir un autre fichier
        </button>
      </div>
    </div>
  );
}

function Count({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="bg-surface-1 px-4 py-3">
      <dd
        className={`tabular font-editorial text-xl ${muted && value > 0 ? 'text-approximate' : 'text-text-primary'}`}
      >
        {value.toLocaleString('fr-FR')}
      </dd>
      <dt className="text-text-faint mt-0.5 text-xs">{label}</dt>
    </div>
  );
}
