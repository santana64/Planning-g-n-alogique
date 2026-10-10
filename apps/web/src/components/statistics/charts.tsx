'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * The charts of the statistics screen.
 *
 * Small on purpose: column charts, ranked bars and figures — the forms that
 * answer "how many, when" and "which most often", which is what a tree's
 * statistics are. Drawn as SVG and HTML rather than with a chart library: a
 * dozen bars do not need one, and every mark here follows the same rules —
 * thin bars with rounded data ends on the baseline, a two-pixel gap between
 * fills, a recessive grid, text in text colours, a legend whenever there is
 * more than one series, a tooltip on hover, and the numbers again
 * as a table for whoever cannot see the bars.
 */

export interface Series {
  readonly key: string;
  readonly label: string;
  /** A CSS colour, normally a design token: `var(--sex-female)`. */
  readonly color: string;
}

export interface Column {
  readonly key: string;
  /** Axis label: "1850", "70 ans". */
  readonly label: string;
  readonly values: Readonly<Record<string, number>>;
}

const HEIGHT = 180;
const AXIS = 22;
const GAP = 2;

/**
 * The width the chart is actually given, so it is drawn at one SVG unit per
 * pixel. A viewBox stretched to fill its container scales the text with the
 * bars, and a chart of three columns came out with labels four times their
 * size.
 */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((current) => (current === next ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(value: number): number {
  if (value <= 5) return Math.max(value, 1);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/** Stacked columns, one stack per column, series in a fixed order. */
export function ColumnChart({
  title,
  columns,
  series,
  unit,
}: {
  title: string;
  columns: readonly Column[];
  series: readonly Series[];
  /** How a value reads in the tooltip: "{count} naissances". */
  unit: (value: number) => string;
}) {
  const t = useTranslations('statistics.chart');
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const [frame, measured] = useWidth<HTMLDivElement>();

  if (columns.length === 0) {
    return <p className="text-text-faint text-sm">{t('empty')}</p>;
  }

  const totals = columns.map((column) =>
    series.reduce((sum, s) => sum + (column.values[s.key] ?? 0), 0),
  );
  const max = niceMax(Math.max(...totals, 1));
  const width = Math.max(measured, 240);
  const slot = width / columns.length;
  // Thin bars: at most 28 px, with at least a quarter of the slot as air.
  const barWidth = Math.max(Math.min(slot * 0.72, 28), 3);
  const plot = HEIGHT - AXIS;
  // Label every nth column so labels never collide.
  const every = Math.max(1, Math.ceil(columns.length / Math.floor(width / 44)));
  const ticks = [0, 0.5, 1].map((fraction) => Math.round(max * fraction));

  const activeColumn = active === null ? null : columns[active];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption id={`${id}-title`} className="text-text-secondary text-sm font-medium">
        {title}
      </figcaption>

      {series.length > 1 ? (
        <ul className="text-text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-hidden="true">
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: s.color }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div ref={frame} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block overflow-visible"
          role="img"
          aria-labelledby={`${id}-title`}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((tick) => {
            const y = plot - (tick / max) * (plot - 8);
            return (
              <g key={tick}>
                <line
                  x1={0}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="var(--border-subtle)"
                  strokeWidth={1}
                />
                {tick > 0 ? (
                  <text x={0} y={y - 3} fontSize={10} fill="var(--text-faint)">
                    {tick}
                  </text>
                ) : null}
              </g>
            );
          })}

          {columns.map((column, index) => {
            const x = index * slot + (slot - barWidth) / 2;
            let base = plot;
            const segments = series
              .map((s) => ({ s, value: column.values[s.key] ?? 0 }))
              .filter((segment) => segment.value > 0);
            return (
              <g
                key={column.key}
                // Pointer only: inside an image, a focusable mark is noise to
                // a screen reader. The keyboard reads the table below.
                onMouseEnter={() => setActive(index)}
                className="stat-column"
                style={{ animationDelay: `${Math.min(index, 30) * 18}ms` }}
              >
                {/* A hit target the whole height of the column, wider than the bar. */}
                <rect x={index * slot} y={0} width={slot} height={plot} fill="transparent" />
                {segments.map((segment, segmentIndex) => {
                  const h = Math.max(
                    (segment.value / max) * (plot - 8) - (segmentIndex > 0 ? GAP : 0),
                    1,
                  );
                  base -= h + (segmentIndex > 0 ? GAP : 0);
                  const top = segmentIndex === segments.length - 1;
                  return (
                    <rect
                      key={segment.s.key}
                      x={x}
                      y={base}
                      width={barWidth}
                      height={h}
                      rx={top ? Math.min(4, barWidth / 2) : 0}
                      fill={segment.s.color}
                      opacity={active === null || active === index ? 1 : 0.45}
                    />
                  );
                })}
                {index % every === 0 ? (
                  <text
                    x={index * slot + slot / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill={active === index ? 'var(--text-primary)' : 'var(--text-muted)'}
                  >
                    {column.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line
            x1={0}
            x2={width}
            y1={plot}
            y2={plot}
            stroke="var(--border-default)"
            strokeWidth={1}
          />
        </svg>

        {activeColumn && active !== null ? (
          <div
            className="timeline-tooltip border-border-default bg-surface-floating pointer-events-none absolute top-0 z-10 rounded-[var(--radius-md)] border px-3 py-2 text-xs shadow-[var(--shadow-mid)]"
            style={{
              left: `${Math.min(((active + 0.5) / columns.length) * 100, 80)}%`,
              transform: 'translateX(-50%)',
            }}
            role="status"
          >
            <p className="text-text-primary font-medium">{activeColumn.label}</p>
            {series.map((s) => (
              <p
                key={s.key}
                className="text-text-secondary mt-0.5 inline-flex w-full items-center gap-1.5"
              >
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {series.length > 1 ? `${s.label} : ` : ''}
                {unit(activeColumn.values[s.key] ?? 0)}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <DataTable
        caption={title}
        head={[t('label'), ...series.map((s) => s.label)]}
        rows={columns.map((column) => [
          column.label,
          ...series.map((s) => String(column.values[s.key] ?? 0)),
        ])}
      />
    </figure>
  );
}

/** "Which most often": horizontal bars, longest first, values written out. */
export function RankedBars({
  title,
  items,
  color = 'var(--accent-primary)',
  empty,
}: {
  title: string;
  items: ReadonlyArray<{ readonly label: string; readonly count: number }>;
  color?: string;
  empty?: string;
}) {
  const t = useTranslations('statistics.chart');
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-text-secondary text-sm font-medium">{title}</figcaption>
      {items.length === 0 ? (
        <p className="text-text-faint text-sm">{empty ?? t('empty')}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <li
              key={item.label}
              className="grid grid-cols-[minmax(6rem,10rem)_1fr_2.5rem] items-center gap-2 text-sm"
            >
              <span className="text-text-secondary truncate" title={item.label}>
                {item.label}
              </span>
              <span className="bg-surface-2 h-2 overflow-hidden rounded-full" aria-hidden="true">
                <span
                  className="stat-bar block h-full rounded-full"
                  style={{
                    width: `${(item.count / max) * 100}%`,
                    background: color,
                    animationDelay: `${index * 40}ms`,
                  }}
                />
              </span>
              <span className="text-text-muted text-right tabular-nums">{item.count}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

/** A single headline figure, with what it rests on. */
export function StatTile({
  value,
  label,
  note,
  delay = 0,
}: {
  value: ReactNode;
  label: string;
  note?: string;
  delay?: number;
}) {
  return (
    <div
      className="rise border-border-subtle bg-surface-0 flex flex-col gap-1 rounded-[var(--radius-lg)] border p-4 shadow-[var(--shadow-low)]"
      style={{ ['--delay' as string]: `${delay}ms` }}
    >
      <span className="font-editorial text-text-primary text-3xl tabular-nums">{value}</span>
      <span className="text-text-secondary text-sm">{label}</span>
      {note ? <span className="text-text-faint text-xs">{note}</span> : null}
    </div>
  );
}

function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
}) {
  const t = useTranslations('statistics.chart');
  return (
    <details className="text-xs">
      <summary className="text-text-faint hover:text-text-primary cursor-pointer select-none">
        {t('showData')}
      </summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-text-secondary">
            <tr>
              {head.map((cell) => (
                <th key={cell} scope="col" className="py-1 pr-4 font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-text-muted tabular-nums">
            {rows.map((row) => (
              <tr key={row[0]} className="border-border-subtle border-t">
                {row.map((cell, index) =>
                  index === 0 ? (
                    <th key={index} scope="row" className="py-1 pr-4 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={index} className="py-1 pr-4">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
