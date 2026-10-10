'use client';

import { useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { TimelineBand, TimelineSnapshot } from '@/server/timeline';
import { swatchFor } from './preferences';
import type { TimelineColorMode } from './render-timeline';
import { periodLabel } from './period';

/**
 * A historical event, beside the family that lived through it.
 *
 * Who in the tree was alive during the event, and how old each was when it
 * began — computed only from the lives the timeline was given, so protected
 * relatives are neither counted nor named. Each name selects that life on
 * the chart.
 */
export function HistoryPanel({
  band,
  snapshot,
  colorMode,
  onSelectPerson,
  onClose,
}: {
  band: TimelineBand;
  snapshot: TimelineSnapshot;
  colorMode: TimelineColorMode;
  onSelectPerson: (personId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('timeline.history');
  const format = useFormatter();

  const witnesses = useMemo(
    () =>
      snapshot.rows
        .filter(
          (row) =>
            !row.redacted &&
            row.earliestJdn !== null &&
            row.latestJdn !== null &&
            row.earliestJdn <= band.endJdn &&
            row.latestJdn >= band.startJdn,
        )
        .map((row) => {
          const birth = row.birthEarliestJdn ?? row.earliestJdn ?? band.startJdn;
          const age = Math.max(Math.floor((band.startJdn - birth) / 365.2425), 0);
          return { row, age, unborn: birth > band.startJdn };
        })
        .sort((a, b) => b.age - a.age),
    [snapshot.rows, band],
  );

  return (
    <aside
      key={band.id}
      className="timeline-panel border-border-subtle bg-surface-1 border-t px-5 py-3"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className="text-[11px] tracking-wide uppercase"
          style={{ color: `var(--hist-${band.category.toLowerCase()})` }}
        >
          {t(`categories.${band.category}`)}
        </span>
        <span className="font-editorial text-text-primary">{band.title}</span>
        <span className="text-text-muted text-sm tabular-nums">
          {periodLabel(band.startJdn, band.endJdn, format)}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary ml-auto text-sm"
        >
          {t('close')}
        </button>
      </div>
      {band.summary ? (
        <p className="text-text-secondary mt-1 max-w-3xl text-sm">{band.summary}</p>
      ) : null}
      <p className="text-text-faint mt-2 text-xs">{t('witnesses', { count: witnesses.length })}</p>
      {witnesses.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {witnesses.slice(0, 24).map(({ row, age, unborn }) => (
            <li key={row.personId}>
              <button
                type="button"
                onClick={() => onSelectPerson(row.personId)}
                className="border-border-default hover:border-border-strong text-text-secondary hover:text-text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-[var(--duration-fast)]"
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: swatchFor(row, colorMode) }}
                />
                {row.displayName}
                <span className="text-text-faint">
                  {unborn ? t('bornDuring') : t('age', { age })}
                </span>
              </button>
            </li>
          ))}
          {witnesses.length > 24 ? (
            <li className="text-text-faint self-center text-xs">
              {t('more', { count: witnesses.length - 24 })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </aside>
  );
}
