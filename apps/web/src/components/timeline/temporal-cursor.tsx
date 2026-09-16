'use client';

import { useId } from 'react';
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

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

function formatJdn(jdn: number): string {
  const { year, month, day } = jdnToGregorian(jdn);
  return `${day === 1 ? '1er' : day} ${MONTHS[month - 1] ?? ''} ${year}`;
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
          Voyager dans le temps
        </button>
        <span className="text-text-faint text-xs">
          Choisir une date et voir qui était vivant ce jour-là.
        </span>
      </div>
    );
  }

  return (
    <div className="border-border-subtle bg-surface-1 border-t px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor={dateId} className="text-text-secondary text-sm">
            Le
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
          <span className="font-editorial text-text-primary text-sm">{formatJdn(jdn)}</span>
        </div>

        {alive && <AliveCounts alive={alive} />}

        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-text-muted hover:text-text-primary ml-auto text-sm underline underline-offset-2"
        >
          Quitter le voyage temporel
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
          aria-label="Curseur temporel"
          aria-valuetext={formatJdn(jdn)}
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
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" role="status">
      <span className="text-text-primary">
        <strong className="tabular font-semibold">{alive.certain}</strong>{' '}
        <span className="text-text-muted">avec certitude</span>
      </span>
      <span className="text-approximate">
        <strong className="tabular font-semibold">{alive.possible}</strong>{' '}
        <span className="text-text-muted">possiblement</span>
      </span>
      <span className="text-text-faint">
        <strong className="tabular font-semibold">{alive.undated}</strong> sans date
      </span>
      {alive.hidden > 0 && (
        <span className="text-text-faint text-xs">
          ({alive.hidden} vivant{alive.hidden > 1 ? 's' : ''} masqué
          {alive.hidden > 1 ? 's' : ''})
        </span>
      )}
    </div>
  );
}
