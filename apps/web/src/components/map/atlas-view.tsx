'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { jdnToGregorian } from '@chronolignee/domain';
import type { AtlasSnapshot } from '@/server/atlas';

/**
 * The map screen.
 *
 * The map is loaded on the client only: MapLibre needs WebGL and a real
 * window, and server-rendering it would produce a blank canvas and a
 * hydration mismatch.
 *
 * The table is not a fallback bolted on afterwards. A canvas is opaque to a
 * screen reader and to anyone who wants to copy a figure out, so the same
 * numbers are published as a real table — the same decision the timeline
 * makes, for the same reason.
 */

const AtlasMap = dynamic(() => import('./atlas-map').then((module) => module.AtlasMap), {
  ssr: false,
  loading: () => <div className="bg-surface-sunken h-full w-full" />,
});

function yearOf(jdn: number): number {
  return jdnToGregorian(jdn).year;
}

export function AtlasView({ snapshot }: { snapshot: AtlasSnapshot }) {
  const t = useTranslations('atlas');
  const [cursorJdn, setCursorJdn] = useState<number | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const firstYear = yearOf(snapshot.earliestJdn);
  const lastYear = yearOf(snapshot.latestJdn);

  const visiblePlaces = useMemo(
    () =>
      snapshot.points.filter(
        (point) => cursorJdn === null || (point.earliestJdn ?? Infinity) <= cursorJdn,
      ),
    [snapshot.points, cursorJdn],
  );

  const visibleArcs = useMemo(
    () => snapshot.arcs.filter((arc) => cursorJdn === null || arc.latestJdn <= cursorJdn),
    [snapshot.arcs, cursorJdn],
  );

  const selected = snapshot.points.find((point) => point.placeId === selectedPlaceId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border-subtle relative h-[60vh] overflow-hidden rounded-[var(--radius-lg)] border">
        <AtlasMap
          points={snapshot.points}
          arcs={snapshot.arcs}
          cursorJdn={cursorJdn}
          onSelect={setSelectedPlaceId}
          selectedPlaceId={selectedPlaceId}
        />

        {selected ? (
          <aside className="border-border-default bg-surface-floating absolute top-4 left-4 max-w-xs rounded-[var(--radius-md)] border px-4 py-3 shadow-[var(--shadow-mid)]">
            <p className="font-editorial text-text-primary text-base">{selected.name}</p>
            <p className="text-text-muted mt-1 text-sm">
              {t('placeCounts', {
                events: selected.eventCount,
                people: selected.personCount,
              })}
            </p>
            {selected.earliestJdn !== null && selected.latestJdn !== null ? (
              <p className="text-text-faint tabular mt-1 text-xs">
                {yearOf(selected.earliestJdn)} – {yearOf(selected.latestJdn)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setSelectedPlaceId(null)}
              className="text-text-faint hover:text-accent mt-2 text-xs"
            >
              {t('close')}
            </button>
          </aside>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <label htmlFor="atlas-cursor" className="text-text-secondary text-sm">
            {t('year')}
          </label>
          <input
            id="atlas-cursor"
            type="range"
            min={snapshot.earliestJdn}
            max={snapshot.latestJdn}
            step={365}
            value={cursorJdn ?? snapshot.latestJdn}
            onChange={(event) => setCursorJdn(Number(event.target.value))}
            className="accent-accent max-w-md flex-1"
          />
          <output
            htmlFor="atlas-cursor"
            className="tabular text-text-primary w-16 text-sm"
            aria-live="polite"
          >
            {cursorJdn === null ? t('all') : yearOf(cursorJdn)}
          </output>
          {cursorJdn !== null ? (
            <button
              type="button"
              onClick={() => setCursorJdn(null)}
              className="text-text-faint hover:text-accent text-xs"
            >
              {t('showAll')}
            </button>
          ) : null}
        </div>

        <p className="text-text-muted text-sm">
          {t('summary', {
            places: visiblePlaces.length,
            moves: visibleArcs.length,
            from: firstYear,
            to: lastYear,
          })}
        </p>

        {/* Said, not hidden. A map that quietly omits a third of the archive
         * is a map that lies about where the family was. */}
        {snapshot.unplacedCount > 0 ? (
          <p className="text-text-faint text-sm">
            {t('unplaced', { count: snapshot.unplacedCount })}
          </p>
        ) : null}

        {snapshot.withheldPeople > 0 ? (
          <p className="text-source text-sm">{t('withheld', { count: snapshot.withheldPeople })}</p>
        ) : null}

        <button
          type="button"
          onClick={() => setShowTable((current) => !current)}
          className="text-accent self-start text-sm hover:underline"
        >
          {showTable ? t('hideTable') : t('showTable')}
        </button>

        {showTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('tableCaption')}</caption>
              <thead>
                <tr className="text-text-faint border-border-subtle border-b text-left">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t('columns.place')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t('columns.events')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t('columns.people')}
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    {t('columns.period')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiblePlaces.map((point) => (
                  <tr key={point.placeId} className="border-border-subtle border-b">
                    <td className="py-2 pr-4">{point.name}</td>
                    <td className="tabular py-2 pr-4">{point.eventCount}</td>
                    <td className="tabular py-2 pr-4">{point.personCount}</td>
                    <td className="tabular text-text-muted py-2">
                      {point.earliestJdn === null || point.latestJdn === null
                        ? '—'
                        : `${yearOf(point.earliestJdn)} – ${yearOf(point.latestJdn)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
