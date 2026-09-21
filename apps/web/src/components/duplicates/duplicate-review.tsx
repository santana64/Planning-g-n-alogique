'use client';

import { useActionState, useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { signalSentence } from '@/lib/duplicate-signals';
import { IDLE, type ActionState } from '@/server/action-state';
import { scanDuplicatesAction } from '@/server/duplicate-actions';
import { DuplicateDismissButton } from './duplicate-dismiss';
import type { DuplicatePairView } from '@/server/duplicates';
import type { ScanState } from '@/lib/queue';

/**
 * The pairs a scan brought back.
 *
 * Each one says why it is here — the signals that produced the score — and
 * offers the only two honest answers: look at both records side by side, or
 * say they are two people. Nothing merges from this list: a merge retires a
 * record, and that decision belongs on the page that shows what is at stake.
 */

/** How often a running scan is asked whether it has finished. */
const POLL_MS = 1_500;

export function DuplicateReviewList({
  treeSlug,
  pairs,
  scanState,
}: {
  treeSlug: string;
  pairs: readonly DuplicatePairView[];
  scanState: ScanState;
}) {
  const [scan, scanAction, scanning] = useActionState<ActionState, FormData>(
    scanDuplicatesAction,
    IDLE,
  );
  const router = useRouter();
  const [tick, setTick] = useState(0);

  const running = scanState === 'queued' || scanState === 'running';

  // While the scan runs, ask the page again rather than inventing an
  // endpoint: re-rendering the server component reads the queue and the
  // pairs in one pass, and there is no client state to keep in step with
  // the database. Each refresh schedules the next; a finished scan stops it.
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(() => {
      router.refresh();
      setTick((value) => value + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [running, router, tick]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <form action={scanAction}>
          <input type="hidden" name="treeSlug" value={treeSlug} />
          <button
            type="submit"
            disabled={scanning || running}
            className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {running ? 'Recherche en cours…' : 'Chercher des doublons'}
          </button>
        </form>
        {scanState === 'failed' ? (
          <p className="text-danger text-sm">
            La dernière recherche s’est interrompue. Relancez-la.
          </p>
        ) : null}
        {scan.status !== 'idle' && scan.message ? (
          <p
            role="status"
            className={scan.status === 'error' ? 'text-danger text-sm' : 'text-text-muted text-sm'}
          >
            {scan.message}
          </p>
        ) : null}
      </div>

      {pairs.length === 0 ? (
        <p className="text-text-muted text-sm">
          Aucun rapprochement en attente. La recherche compare les noms proches, puis les dates, les
          parents, les enfants et les lieux ; elle ne propose rien qu’une date ou un lien de parenté
          écarte.
        </p>
      ) : (
        <ul className="border-border-subtle flex flex-col rounded-[var(--radius-lg)] border">
          {pairs.map((pair) => (
            <li
              key={pair.id}
              className="border-border-subtle flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-editorial text-text-primary text-base">
                  {pair.left.displayName}{' '}
                  <span className="text-text-faint text-sm">({pair.left.lifespan})</span>
                  <span className="text-text-muted mx-2">·</span>
                  {pair.right.displayName}{' '}
                  <span className="text-text-faint text-sm">({pair.right.lifespan})</span>
                </p>
                <p className="text-text-faint text-xs">
                  {Math.round(pair.score * 100)} % — {signalSentence(pair.signals)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  href={`/app/${treeSlug}/doublons/${pair.id}`}
                  className="text-accent text-sm hover:underline"
                >
                  Comparer
                </Link>
                <DuplicateDismissButton
                  treeSlug={treeSlug}
                  candidateId={pair.id}
                  className="text-text-faint hover:text-text-primary text-sm disabled:opacity-60"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
