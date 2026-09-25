'use client';

import { useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { dateToJdn, gregorianToJdn, jdnToGregorian } from '@chronolignee/domain';
import type { AliveSnapshot } from './who-was-alive';

/**
 * Time travel.
 *
 * A single day, chosen by the reader, that the whole timeline answers to. The
 * counts beside it are the product's central claim made concrete: three
 * numbers, never one.
 *
 * "42 people were alive on 8 May 1945" is a sentence the evidence usually
 * cannot support. "42 certainly, 7 possibly, 12 with no dates at all" is what
 * the records actually say — and the third number is the one that tells a
 * researcher where to go next.
 */

/**
 * A Julian day number as a real Date, for Intl.
 *
 * Through UTC and `setUTCFullYear`, because `new Date(1789, 6, 14)` is the
 * year 1789 only by accident of the two-digit rule, and the dates this cursor
 * reaches are exactly the ones where that rule bites.
 */
function dateOf(jdn: number): Date {
  const { year, month, day } = jdnToGregorian(jdn);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date;
}

function toInputValue(jdn: number): string {
  const { year, month, day } = jdnToGregorian(jdn);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Dates people reach for first. Cheap to offer and genuinely used. */
const LANDMARKS: ReadonlyArray<{ label: string; jdn: number }> = [
  { label: '1789', jdn: gregorianToJdn(1789, 7, 14) },
  { label: '1870', jdn: gregorianToJdn(1870, 7, 19) },
  { label: '1914', jdn: gregorianToJdn(1914, 8, 3) },
  { label: '1945', jdn: gregorianToJdn(1945, 5, 8) },
  { label: "Aujourd'hui", jdn: dateToJdn(new Date()) },
];

export interface TemporalCursorProps {
  readonly jdn: number | null;
  readonly onChange: (jdn: number | null) => void;
  readonly minJdn: number;
  readonly maxJdn: number;
  readonly alive: AliveSnapshot | null;
}

export function TemporalCursor({ jdn, onChange, minJdn, maxJdn, alive }: TemporalCursorProps) {
  const t = useTranslations('timeline.cursor');
  const format = useFormatter();
  // The reader's calendar for an interface date: this is a Gregorian day, not
  // a genealogical date with its own uncertainty, so Intl is the right tool.
  const longDate = (value: number): string =>
    format.dateTime(dateOf(value), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const sliderId = useId();
  const dateId = `${sliderId}-date`;

  if (jdn === null) {
    return (
      <div className="border-border-subtle flex items-center gap-3 border-t px-5 py-2">
        <button
          type="button"
          onClick={() => onChange(LANDMARKS[3]?.jdn ?? maxJdn)}
          className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)]"
        >
          {t('travel')}
        </button>
        <span className="text-text-faint text-xs">{t('travelHint')}</span>
      </div>
    );
  }

  return (
    <div className="border-border-subtle bg-surface-1 border-t px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor={dateId} className="text-text-secondary text-sm">
            {t('on')}
          </label>
          {/* A real date input alongside the slider: a slider cannot reach one
              specific day across three centuries, and a researcher usually has
              a specific day in mind. */}
          <input
            id={dateId}
            type="date"
            value={toInputValue(jdn)}
            min={toInputValue(minJdn)}
            max={toInputValue(maxJdn)}
            onChange={(event) => {
              const [year, month, day] = event.target.value.split('-').map(Number);
              if (year && month && day) onChange(gregorianToJdn(year, month, day));
            }}
            className="bg-surface-2 border-border-default text-text-primary rounded-[var(--radius-sm)] border px-2 py-1 text-sm"
          />
          <span className="font-editorial text-text-primary text-sm">{longDate(jdn)}</span>
        </div>

        {alive && <AliveCounts alive={alive} />}

        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-text-muted hover:text-text-primary ml-auto text-sm underline underline-offset-2"
        >
          {t('leave')}
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <input
          id={sliderId}
          type="range"
          min={minJdn}
          max={maxJdn}
          step={1}
          value={jdn}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={t('slider')}
          aria-valuetext={longDate(jdn)}
          className="accent-accent h-1 flex-1 cursor-pointer"
        />
        <div className="flex gap-1.5">
          {LANDMARKS.map((landmark) => (
            <button
              key={landmark.label}
              type="button"
              onClick={() => onChange(landmark.jdn)}
              className="border-border-subtle text-text-faint hover:border-border-strong hover:text-text-secondary rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs transition-colors duration-[var(--duration-fast)]"
            >
              {landmark.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The three numbers.
 *
 * Deliberately not summed. A single total would require choosing whether
 * "possibly alive" counts, and either choice is a claim the sources do not
 * make.
 */
function AliveCounts({ alive }: { alive: AliveSnapshot }) {
  const t = useTranslations('timeline.alive');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" role="status">
      <span className="text-text-primary">
        <strong className="tabular font-semibold">{alive.certain}</strong>{' '}
        <span className="text-text-muted">{t('certain')}</span>
      </span>
      <span className="text-approximate">
        <strong className="tabular font-semibold">{alive.possible}</strong>{' '}
        <span className="text-text-muted">{t('possible')}</span>
      </span>
      <span className="text-text-faint">
        <strong className="tabular font-semibold">{alive.undated}</strong> {t('undated')}
      </span>
      {alive.hidden > 0 && (
        <span className="text-text-faint text-xs">{t('hidden', { count: alive.hidden })}</span>
      )}
    </div>
  );
}
