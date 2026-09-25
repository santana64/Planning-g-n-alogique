'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
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

export function TimelineView({ snapshot }: { snapshot: TimelineSnapshot }) {
  const t = useTranslations('timeline');
  const certainty = useTranslations('certainty');
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
            {t(snapshot.eventsTruncated ? 'countsPartial' : 'counts', {
              people: snapshot.rows.length,
              events: snapshot.events.length,
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            aria-pressed={showTable}
            className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)]"
          >
            {showTable ? t('showTimeline') : t('showTable')}
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
            {selected.redacted ? (
              <span className="text-text-muted text-sm">{t('nothingPublished')}</span>
            ) : (
              <>
                <span className="text-text-muted text-sm">
                  {t('birth', {
                    date: selected.birthLabel,
                    certainty: certainty(selected.startCertainty),
                  })}
                </span>
                <span className="text-text-muted text-sm">
                  {selected.isLiving
                    ? t('living')
                    : t('death', {
                        date: selected.deathLabel,
                        certainty: certainty(selected.endCertainty),
                      })}
                </span>
              </>
            )}
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
  const t = useTranslations('timeline');
  const certainty = useTranslations('certainty');
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <caption className="text-text-faint px-5 py-2 text-left text-xs">
          {t('tableCaption', { tree: snapshot.treeName })}
        </caption>
        <thead className="bg-surface-2 text-text-secondary sticky top-0 text-left">
          <tr>
            <th scope="col" className="px-5 py-2 font-medium">
              {t('columns.name')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('columns.birth')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('columns.death')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('columns.certainty')}
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
                {row.isLiving ? t('living') : row.deathLabel}
              </td>
              <td className="text-text-faint px-3 py-1.5">
                {/* A redacted row reveals nothing, not even how well dated it
                    is: "exacte" tells a reader the birth was precisely
                    recorded, which is a fact about a person who did not agree
                    to be published. */}
                {row.redacted
                  ? '—'
                  : `${certainty(row.startCertainty)} / ${certainty(row.endCertainty)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend() {
  const t = useTranslations('timeline.legend');
  return (
    <div className="border-border-subtle text-text-faint flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-5 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-certain h-0.5 w-6" />
        {t('recorded')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-6"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, var(--certainty-approximate) 0 6px, transparent 6px 9px)',
          }}
        />
        {t('approximate')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-6"
          style={{
            backgroundImage: 'linear-gradient(90deg, var(--certainty-inferred), transparent)',
          }}
        />
        {t('inferred')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="bg-accent h-3 w-px" />
        {t('today')}
      </span>
    </div>
  );
}
