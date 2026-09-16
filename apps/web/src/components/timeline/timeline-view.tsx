'use client';

import { useMemo, useState } from 'react';
import { TimelineCanvas } from './timeline-canvas';
import { TemporalCursor } from './temporal-cursor';
import { whoWasAlive } from './who-was-alive';
import type { TimelineSnapshot } from '@/server/timeline';

/**
 * The Chronology surface.
 *
 * Canvas and table are two presentations of one dataset, not a visual view
 * plus a grudging fallback. The table is reachable by everyone and is the
 * canonical representation for a screen reader; toggling to it is a normal
 * thing a sighted researcher might also want when copying dates out.
 */

const CERTAINTY_LABELS: Record<string, string> = {
  EXACT: 'exacte',
  APPROXIMATE: 'approximative',
  INFERRED: 'déduite',
  UNKNOWN: 'inconnue',
};

export function TimelineView({ snapshot }: { snapshot: TimelineSnapshot }) {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [cursorJdn, setCursorJdn] = useState<number | null>(null);

  const selected = snapshot.rows.find((row) => row.personId === selectedPersonId);

  // Recomputed on every cursor move. Forty rows is nothing; twenty thousand is
  // one pass over a typed array, which is still well inside a frame.
  const alive = useMemo(
    () => (cursorJdn === null ? null : whoWasAlive(snapshot.rows, cursorJdn, snapshot.todayJdn)),
    [cursorJdn, snapshot.rows, snapshot.todayJdn],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h1 className="font-editorial text-text-primary text-lg tracking-tight">
            {snapshot.treeName}
          </h1>
          <p className="text-text-faint text-xs">
            {snapshot.rows.length} personnes · {snapshot.events.length} événements
            {snapshot.eventsTruncated && ' (partiels)'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            aria-pressed={showTable}
            className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)]"
          >
            {showTable ? 'Voir la frise' : 'Voir le tableau'}
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {showTable ? (
          <TimelineTable snapshot={snapshot} onSelect={setSelectedPersonId} />
        ) : (
          <TimelineCanvas
            snapshot={snapshot}
            selectedPersonId={selectedPersonId}
            onSelect={setSelectedPersonId}
            cursor={cursorJdn !== null && alive ? { jdn: cursorJdn, states: alive.states } : null}
          />
        )}
      </div>

      <TemporalCursor
        jdn={cursorJdn}
        onChange={setCursorJdn}
        minJdn={snapshot.earliestJdn}
        maxJdn={snapshot.latestJdn}
        alive={alive}
      />

      <Legend />

      {selected && (
        <aside className="border-border-subtle bg-surface-1 border-t px-5 py-3" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-editorial text-text-primary">{selected.displayName}</span>
            <span className="text-text-muted text-sm">
              Naissance : {selected.birthLabel} ({CERTAINTY_LABELS[selected.startCertainty]})
            </span>
            <span className="text-text-muted text-sm">
              {selected.isLiving
                ? 'Vivant'
                : `Décès : ${selected.deathLabel} (${CERTAINTY_LABELS[selected.endCertainty]})`}
            </span>
          </div>
        </aside>
      )}
    </div>
  );
}

/**
 * The parallel representation.
 *
 * Every row the canvas draws, as a real table: sortable by the browser's own
 * reading order, copyable, and navigable by keyboard without knowing any of
 * the timeline's gestures.
 */
function TimelineTable({
  snapshot,
  onSelect,
}: {
  snapshot: TimelineSnapshot;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <caption className="text-text-faint px-5 py-2 text-left text-xs">
          Chronologie de {snapshot.treeName}, sous forme de tableau. Chaque ligne correspond à une
          barre de la frise.
        </caption>
        <thead className="bg-surface-2 text-text-secondary sticky top-0 text-left">
          <tr>
            <th scope="col" className="px-5 py-2 font-medium">
              Nom
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Naissance
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Décès
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Certitude
            </th>
          </tr>
        </thead>
        <tbody>
          {snapshot.rows.map((row) => (
            <tr key={row.personId} className="border-border-subtle hover:bg-surface-1 border-b">
              <th scope="row" className="px-5 py-1.5 text-left font-normal">
                <button
                  type="button"
                  onClick={() => onSelect(row.personId)}
                  className="font-editorial text-text-primary hover:text-accent text-left"
                >
                  {row.displayName}
                </button>
              </th>
              <td className="text-text-muted px-3 py-1.5">{row.birthLabel}</td>
              <td className="text-text-muted px-3 py-1.5">
                {row.isLiving ? 'Vivant' : row.deathLabel}
              </td>
              <td className="text-text-faint px-3 py-1.5">
                {/* A redacted row reveals nothing, not even how well dated it
                    is: "exacte" tells a reader the birth was precisely
                    recorded, which is a fact about a living person they did
                    not agree to publish. */}
                {row.redacted
                  ? '—'
                  : `${CERTAINTY_LABELS[row.startCertainty]} / ${CERTAINTY_LABELS[row.endCertainty]}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend() {
  return (
    <div className="border-border-subtle text-text-faint flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-5 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-certain h-0.5 w-6" />
        Date enregistrée
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-6"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, var(--certainty-approximate) 0 6px, transparent 6px 9px)',
          }}
        />
        Date approximative
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-6"
          style={{
            backgroundImage: 'linear-gradient(90deg, var(--certainty-inferred), transparent)',
          }}
        />
        Limite déduite, pas enregistrée
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-accent h-3 w-px" />
        Aujourd&apos;hui
      </span>
    </div>
  );
}
