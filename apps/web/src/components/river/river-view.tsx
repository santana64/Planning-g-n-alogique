'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ofNameIn } from '@/lib/french';
import { coursePath, streamPath, type RiverStream } from '@chronolignee/engine';
import { branchColorForKey } from '@chronolignee/ui';
import { Link } from '@/i18n/navigation';
import type { RiverView as RiverData } from '@/server/river';

/**
 * The river, drawn.
 *
 * SVG rather than a canvas: a few dozen smooth shapes, each one a branch a
 * reader can point at, and text that stays text. The water runs left to
 * right — dashes drift along each stream's centre — and the whole river
 * pours in from the oldest year on first display. Both stop under reduced
 * motion; nothing here is information that only moves.
 */

const HEIGHT = 560;
const PADDING = { left: 24, right: 24, top: 28, bottom: 36 };

export function RiverView({ data, treeSlug }: { data: RiverData; treeSlug: string }) {
  const t = useTranslations('river');
  const locale = useLocale();
  // "Branche d’Adèle", "Branch of Adèle": the elision is French grammar.
  const branchOf = (name: string) => t('branchOf', { of: ofNameIn(locale, name) });
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [poured, setPoured] = useState(false);
  const { layout, branches } = data;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Pour the river in once it has a width to fill.
  useEffect(() => {
    if (width === 0 || poured) return;
    const frame = requestAnimationFrame(() => setPoured(true));
    return () => cancelAnimationFrame(frame);
  }, [width, poured]);

  const scales = useMemo(() => {
    const span = Math.max(layout.toYear - layout.fromYear, 1);
    const inner = Math.max(width - PADDING.left - PADDING.right, 1);
    const x = (year: number) => PADDING.left + ((year - layout.fromYear) / span) * inner;
    const centre = PADDING.top + (HEIGHT - PADDING.top - PADDING.bottom) / 2;
    const perPerson = (HEIGHT - PADDING.top - PADDING.bottom) / Math.max(layout.maxWidth, 1);
    const y = (people: number) => centre + people * perPerson;
    return { x, y, perPerson };
  }, [layout, width]);

  const ticks = useMemo(() => {
    const span = layout.toYear - layout.fromYear;
    const step = span > 300 ? 50 : span > 120 ? 25 : 10;
    const first = Math.ceil(layout.fromYear / step) * step;
    const list: number[] = [];
    for (let year = first; year <= layout.toYear; year += step) list.push(year);
    return list;
  }, [layout]);

  const nameOf = (stream: RiverStream) => branches[stream.branchKey]?.founderName ?? null;
  const active = hovered ? layout.streams.find((stream) => stream.branchKey === hovered) : null;

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="border-border-subtle bg-surface-sunken relative overflow-hidden rounded-[var(--radius-lg)] border"
        style={{ height: HEIGHT }}
      >
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={t('figure', { tree: data.treeName, branches: layout.streams.length })}
            onMouseLeave={() => setHovered(null)}
          >
            <defs>
              <clipPath id="river-pour">
                <rect
                  x={0}
                  y={0}
                  height={HEIGHT}
                  width={poured ? width : 0}
                  className="river-pour"
                />
              </clipPath>
              <linearGradient id="river-sheen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
                <stop offset="45%" stopColor="#fff" stopOpacity="0" />
                <stop offset="100%" stopColor="#000" stopOpacity="0.22" />
              </linearGradient>
            </defs>

            {ticks.map((year) => (
              <g key={year}>
                <line
                  x1={scales.x(year)}
                  x2={scales.x(year)}
                  y1={PADDING.top - 8}
                  y2={HEIGHT - PADDING.bottom}
                  className="stroke-border-subtle"
                  strokeWidth={1}
                />
                <text
                  x={scales.x(year)}
                  y={HEIGHT - 14}
                  textAnchor="middle"
                  className="fill-text-faint text-[11px] tabular-nums"
                >
                  {year}
                </text>
              </g>
            ))}

            {data.todayYear <= layout.toYear ? (
              <line
                x1={scales.x(data.todayYear)}
                x2={scales.x(data.todayYear)}
                y1={PADDING.top - 8}
                y2={HEIGHT - PADDING.bottom}
                className="stroke-text-faint"
                strokeDasharray="3 4"
              />
            ) : null}

            <g clipPath="url(#river-pour)">
              {layout.streams.map((stream) => {
                const colour = branchColorForKey(stream.branchKey).base;
                const path = streamPath(stream.samples, scales.x, scales.y);
                const dimmed = hovered !== null && hovered !== stream.branchKey;
                const course = stream.samples.filter(
                  (sample) =>
                    sample.year >= stream.firstYear &&
                    sample.year <= stream.lastYear &&
                    sample.y1 - sample.y0 > 0.2,
                );
                const centre = course.length > 1 ? coursePath(course, scales.x, scales.y) : '';
                return (
                  <g
                    key={stream.branchKey}
                    className="river-stream"
                    style={{ opacity: dimmed ? 0.28 : 1 }}
                    onMouseEnter={() => setHovered(stream.branchKey)}
                  >
                    <path d={path} fill={colour} fillOpacity={0.82} />
                    <path d={path} fill="url(#river-sheen)" />
                    <path
                      d={path}
                      fill="none"
                      stroke={colour}
                      strokeOpacity={0.9}
                      strokeWidth={1}
                    />
                    {centre ? (
                      <path
                        d={centre}
                        fill="none"
                        stroke="#fff"
                        strokeOpacity={0.35}
                        strokeWidth={1.4}
                        strokeLinecap="round"
                        strokeDasharray="2 14"
                        className="river-flow"
                      />
                    ) : null}
                  </g>
                );
              })}

              {layout.streams.map((stream) => {
                const name = nameOf(stream);
                const widest = stream.samples.find((sample) => sample.year === stream.widestYear);
                if (!name || !widest) return null;
                const thickness = (widest.y1 - widest.y0) * scales.perPerson;
                if (thickness < 14) return null;
                return (
                  <text
                    key={`label-${stream.branchKey}`}
                    x={scales.x(stream.widestYear)}
                    y={scales.y((widest.y0 + widest.y1) / 2) + 4}
                    textAnchor="middle"
                    className="fill-text-primary font-editorial pointer-events-none text-[12px]"
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'var(--surface-sunken)',
                      strokeWidth: 3,
                      opacity: hovered && hovered !== stream.branchKey ? 0.3 : 1,
                    }}
                  >
                    {branchOf(name)}
                  </text>
                );
              })}
            </g>
          </svg>
        ) : null}

        {active ? (
          <div
            role="status"
            className="border-border-default bg-surface-1/95 pointer-events-none absolute top-3 left-3 rounded-[var(--radius-md)] border px-3 py-2 shadow-[var(--shadow-mid)]"
          >
            <p className="font-editorial text-text-primary text-sm">
              {nameOf(active) ? branchOf(nameOf(active) ?? '') : t('protectedBranch')}
            </p>
            <p className="text-text-muted text-xs tabular-nums">
              {t('summary', {
                people: active.people,
                from: active.firstYear,
                to: Math.min(active.lastYear, data.todayYear),
              })}
            </p>
          </div>
        ) : null}
      </div>

      <section aria-labelledby="river-streams" className="flex flex-col gap-2">
        <h2 id="river-streams" className="text-text-faint text-xs tracking-wide uppercase">
          {t('streams', { count: layout.streams.length })}
        </h2>
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {layout.streams.map((stream) => {
            const branch = branches[stream.branchKey];
            const label = branch?.founderName ? branchOf(branch.founderName) : t('protectedBranch');
            return (
              <li
                key={stream.branchKey}
                className="text-text-secondary flex items-center gap-2 text-sm"
                onMouseEnter={() => setHovered(stream.branchKey)}
                onMouseLeave={() => setHovered(null)}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: branchColorForKey(stream.branchKey).base }}
                />
                {branch?.founderId ? (
                  <Link
                    href={`/app/${treeSlug}/personnes/${branch.founderId}`}
                    className="hover:text-accent"
                  >
                    {label}
                  </Link>
                ) : (
                  <span>{label}</span>
                )}
                <span className="text-text-faint text-xs tabular-nums">
                  {t('summary', {
                    people: stream.people,
                    from: stream.firstYear,
                    to: Math.min(stream.lastYear, data.todayYear),
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
