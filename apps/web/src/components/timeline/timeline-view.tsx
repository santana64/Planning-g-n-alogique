'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { familyOf } from './family';
import { HistoryPanel } from './history-panel';
import { swatchFor, useColorMode } from './preferences';
import type { TimelineColorMode } from './render-timeline';
import { TimelineCanvas } from './timeline-canvas';
import { TemporalCursor } from './temporal-cursor';
import { whoWasAlive } from './who-was-alive';
import type { TimelineSnapshot } from '@/server/timeline';

export function TimelineView({ snapshot }: { snapshot: TimelineSnapshot }) {
  const t = useTranslations('timeline');
  const certainty = useTranslations('certainty');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [cursorJdn, setCursorJdn] = useState<number | null>(null);
  const [colorMode, setColorMode] = useColorMode();
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const selectedBand = snapshot.bands.find((band) => band.id === selectedBandId) ?? null;

  const selected = snapshot.rows.find((row) => row.personId === selectedPersonId);
  const family = useMemo(() => familyOf(snapshot), [snapshot]);

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
          <div
            role="radiogroup"
            aria-label={t('colorMode.label')}
            className="border-border-default bg-surface-1 inline-flex rounded-[var(--radius-md)] border p-0.5"
          >
            {(['SEX', 'BRANCH'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={colorMode === mode}
                onClick={() => setColorMode(mode)}
                className={`rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 text-xs transition-colors duration-[var(--duration-fast)] ${
                  colorMode === mode
                    ? 'bg-surface-3 text-text-primary shadow-[var(--shadow-low)]'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {mode === 'SEX' && (
                  <span aria-hidden="true" className="mr-1.5 inline-flex gap-0.5 align-middle">
                    <span className="bg-sex-female inline-block h-2 w-2 rounded-full" />
                    <span className="bg-sex-male inline-block h-2 w-2 rounded-full" />
                  </span>
                )}
                {t(`colorMode.${mode}`)}
              </button>
            ))}
          </div>
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
            colorMode={colorMode}
            selectedBandId={selectedBandId}
            onSelectBand={setSelectedBandId}
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

      <Legend colorMode={colorMode} />

      {selectedBand ? (
        <HistoryPanel
          band={selectedBand}
          snapshot={snapshot}
          colorMode={colorMode}
          onSelectPerson={(personId) => {
            setSelectedBandId(null);
            setSelectedPersonId(personId);
          }}
          onClose={() => setSelectedBandId(null)}
        />
      ) : null}

      {selected && (
        <aside
          key={selected.personId}
          className="timeline-panel border-border-subtle bg-surface-1 border-t px-5 py-3"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-editorial text-text-primary inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: swatchFor(selected, colorMode) }}
              />
              {selected.displayName}
            </span>
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
            {!selected.redacted && (
              <Link
                href={`/app/${snapshot.treeSlug}/personnes/${selected.personId}`}
                className="text-accent hover:text-accent-hover ml-auto text-sm"
              >
                {t('family.openRecord')}
              </Link>
            )}
          </div>
          {!selected.redacted && (
            <dl className="mt-2.5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <FamilyGroup
                label={t('family.parents')}
                rows={family.parents.get(selected.row) ?? []}
                snapshot={snapshot}
                colorMode={colorMode}
                onSelect={setSelectedPersonId}
              />
              <FamilyGroup
                label={t('family.partners')}
                rows={family.partners.get(selected.row) ?? []}
                snapshot={snapshot}
                colorMode={colorMode}
                onSelect={setSelectedPersonId}
              />
              <FamilyGroup
                label={t('family.children')}
                rows={family.children.get(selected.row) ?? []}
                snapshot={snapshot}
                colorMode={colorMode}
                onSelect={setSelectedPersonId}
              />
            </dl>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * One kind of relative, as buttons: clicking a parent selects them on the
 * timeline and draws their own births, so a lineage can be walked upwards
 * without leaving the chart.
 */
function FamilyGroup({
  label,
  rows,
  snapshot,
  colorMode,
  onSelect,
}: {
  label: string;
  rows: readonly number[];
  snapshot: TimelineSnapshot;
  colorMode: TimelineColorMode;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('timeline.family');
  return (
    <div>
      <dt className="text-text-faint text-xs tracking-wide uppercase">{label}</dt>
      <dd className="mt-1 flex flex-wrap gap-1.5">
        {rows.length === 0 ? (
          <span className="text-text-faint text-xs">{t('none')}</span>
        ) : (
          rows.map((index) => {
            const relative = snapshot.rows[index];
            if (!relative) return null;
            return (
              <button
                key={relative.personId}
                type="button"
                onClick={() => onSelect(relative.personId)}
                disabled={relative.redacted}
                className="border-border-default hover:border-border-strong text-text-secondary hover:text-text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-[var(--duration-fast)] disabled:cursor-default disabled:opacity-60"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: swatchFor(relative, colorMode) }}
                />
                {relative.displayName}
                {relative.lifespanLabel && (
                  <span className="text-text-faint">{relative.lifespanLabel}</span>
                )}
              </button>
            );
          })
        )}
      </dd>
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

function Legend({ colorMode }: { colorMode: TimelineColorMode }) {
  const t = useTranslations('timeline.legend');
  return (
    <div className="border-border-subtle text-text-faint flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-5 py-2 text-xs">
      {colorMode === 'SEX' && (
        <>
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-sex-female h-2 w-6 rounded-full" />
            {t('female')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-sex-male h-2 w-6 rounded-full" />
            {t('male')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-sex-unknown h-2 w-6 rounded-full" />
            {t('sexUnknown')}
          </span>
        </>
      )}
      <span className="inline-flex items-center gap-1.5">
        <svg aria-hidden="true" width="14" height="16" viewBox="0 0 14 16">
          <line x1="7" y1="3" x2="7" y2="12" stroke="var(--sex-male)" strokeWidth="1.5" />
          <circle cx="7" cy="3" r="2.2" fill="var(--sex-male)" />
          <circle
            cx="7"
            cy="12.5"
            r="2.6"
            fill="var(--surface-0)"
            stroke="var(--sex-female)"
            strokeWidth="1.4"
          />
        </svg>
        {t('birthLink')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg aria-hidden="true" width="14" height="16" viewBox="0 0 14 16">
          <line x1="5.5" y1="2" x2="5.5" y2="14" stroke="var(--accent-primary)" />
          <line x1="8.5" y1="2" x2="8.5" y2="14" stroke="var(--accent-primary)" />
        </svg>
        {t('union')}
      </span>
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
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-flex gap-0.5">
          <span className="h-1.5 w-3 rounded-full" style={{ background: 'var(--hist-war)' }} />
          <span
            className="h-1.5 w-3 rounded-full"
            style={{ background: 'var(--hist-political)' }}
          />
          <span className="h-1.5 w-3 rounded-full" style={{ background: 'var(--hist-epidemic)' }} />
        </span>
        {t('history')}
      </span>
    </div>
  );
}
