import { useTranslations } from 'next-intl';
import { Link, getPathname } from '@/i18n/navigation';
import type { TemporalFanView } from '@/server/temporal-fan';
import {
  FAN,
  LABEL,
  angleAt,
  annularSector,
  arc,
  bandRadii,
  labelFits,
  labelPath,
  point,
  radiusFor,
} from './fan-geometry';

/**
 * The temporal fan, drawn.
 *
 * A server component: the chart is static geometry computed from the record,
 * and nothing about it needs a client bundle. The same content is published
 * below as a table — a picture of a pedigree is opaque to a screen reader, and
 * to anyone who wants to copy a date out of it.
 *
 * The table is also where the links are, for keyboards and assistive
 * technology. The drawing is hidden from the accessibility tree and its bands
 * are out of the tab order — they link as a convenience for a pointer. At ten
 * generations it holds a thousand positions, and a tab order a thousand stops
 * long through a picture is not a way to reach anyone. The figure's caption
 * and the table carry everything the drawing shows.
 */

/** How far into the opening, in radians, the year ruler sits. */
const RULER_OFFSET = (3 * Math.PI) / 180;

export function TemporalFanChart({
  view,
  treeSlug,
  locale,
}: {
  view: TemporalFanView;
  treeSlug: string;
  locale: string;
}) {
  const t = useTranslations('fan');
  const years = (value: number): string => t('years', { count: Math.round(value) });
  const personHref = (personId: string) => `/app/${treeSlug}/personnes/${personId}`;
  const scale = Math.max(view.maxYears, ...view.rings.map((ring) => ring.offsetYears), 1);
  const fanStart = angleAt(0);
  const fanEnd = angleAt(1);
  const bySosa = new Map(view.sectors.map((sector) => [sector.sosa, sector]));

  return (
    <figure aria-labelledby="fan-caption" className="flex flex-col gap-6">
      <svg
        viewBox={`0 0 ${FAN.size} ${FAN.size}`}
        className="mx-auto w-full max-w-3xl"
        aria-hidden="true"
      >
        {/* Year guides, on round calendar years. The labels form a ruler in
            the opening at the bottom, the one place no band is ever drawn. */}
        {view.rings.map((ring) => {
          const radius = radiusFor(ring.offsetYears, scale);
          const [labelX, labelY] = point(radius, fanStart - RULER_OFFSET);
          return (
            <g key={ring.year}>
              <path
                d={arc(radius, fanStart, fanEnd)}
                fill="none"
                stroke="var(--border-subtle)"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <text
                x={labelX}
                y={labelY}
                dominantBaseline="middle"
                // The drawing scales with the page: on a phone these would
                // be four pixels tall. CSS outranks the attribute there.
                className="tabular max-sm:[font-size:24px]"
                fontSize={11}
                fill="var(--text-faint)"
              >
                {ring.year}
              </text>
            </g>
          );
        })}

        {/* Connectors: each ancestor to the child through whom they descend. */}
        {view.sectors.map((sector) => {
          const childSosa = Math.floor(sector.sosa / 2);
          const child = childSosa === 1 ? null : bySosa.get(childSosa);
          if (childSosa !== 1 && !child) return null;
          const middle = angleAt((sector.startFraction + sector.endFraction) / 2);
          const from = child ? bandRadii(child, scale).outer : FAN.rInner;
          const to = bandRadii(sector, scale).inner;
          const [x1, y1] = point(from, middle);
          const [x2, y2] = point(to, middle);
          return (
            <line
              key={`link-${sector.sosa}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--border-default)"
              strokeWidth={1}
            />
          );
        })}

        {/* The ancestors: bands whose thickness is how uncertain the birth is. */}
        <g>
          {view.sectors.map((sector) => {
            const person = view.people[sector.personId];
            const radii = bandRadii(sector, scale);
            const paternal = sector.startFraction < 0.5;
            const fill = sector.anomalous
              ? 'var(--accent-danger)'
              : paternal
                ? 'var(--accent-history)'
                : 'var(--accent-primary)';
            return (
              <a
                key={`sector-${sector.sosa}`}
                // A plain SVG anchor cannot localise itself the way the app's
                // links do, so the path is resolved here for the page's locale.
                href={getPathname({ href: personHref(sector.personId), locale })}
                tabIndex={-1}
              >
                <path
                  d={annularSector(
                    radii.inner,
                    radii.outer,
                    angleAt(sector.startFraction),
                    angleAt(sector.endFraction),
                  )}
                  fill={fill}
                  // A range is drawn fainter than a date: the band is wide
                  // because the records are vague, and should not read as more
                  // present than a precisely dated ancestor.
                  fillOpacity={
                    sector.uncertain || sector.innerOpen || sector.outerOpen ? 0.42 : 0.88
                  }
                  stroke="var(--surface-0)"
                  strokeWidth={0.75}
                  className="transition-opacity hover:opacity-70"
                >
                  <title>
                    {t(sector.anomalous ? 'sectorTitleAnomalous' : 'sectorTitle', {
                      sosa: sector.sosa,
                      name: person?.name ?? '',
                      birth: person?.birthLabel ?? '?',
                    })}
                  </title>
                </path>
              </a>
            );
          })}
        </g>

        {/* Names, where they fit whole. Hidden on a phone, where they would be
            specks; the table below carries them there. The halo keeps a name
            legible where a connector runs under it. */}
        <g className="max-sm:hidden">
          {view.sectors.map((sector) => {
            const name = view.people[sector.personId]?.name ?? '';
            const radius = bandRadii(sector, scale).outer + LABEL.gap;
            const start = angleAt(sector.startFraction);
            const end = angleAt(sector.endFraction);
            if (!labelFits(name, radius, start, end)) return null;
            const path = labelPath(radius, start, end);
            const id = `fan-label-${sector.sosa}`;
            return (
              <g key={id}>
                <path id={id} d={path.d} fill="none" stroke="none" />
                <text
                  fontSize={LABEL.fontSize}
                  fill="var(--text-secondary)"
                  stroke="var(--surface-0)"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  dominantBaseline={path.flipped ? 'hanging' : 'auto'}
                >
                  <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
                    {name}
                  </textPath>
                </text>
              </g>
            );
          })}
        </g>

        {/* The subject, at the centre, labelled with the year everything is measured from. */}
        <circle
          cx={FAN.cx}
          cy={FAN.cy}
          r={FAN.rInner - 6}
          fill="var(--surface-2)"
          stroke="var(--border-strong)"
        />
        <text
          x={FAN.cx}
          y={FAN.cy}
          textAnchor="middle"
          // Centred on its own middle, so the year stays centred in the disc
          // at either size.
          dominantBaseline="central"
          fontSize={15}
          className="tabular max-sm:[font-size:30px]"
          fill="var(--text-primary)"
        >
          {view.referenceYear ?? '?'}
        </text>
      </svg>

      <figcaption id="fan-caption" className="text-text-faint text-center text-xs">
        {t('caption', {
          name: view.subjectName,
          placed: t('placed', { count: view.sectors.length }),
        })}
      </figcaption>

      <details className="border-border-subtle rounded-[var(--radius-md)] border px-4 py-3">
        <summary className="text-text-secondary cursor-pointer text-sm">{t('detail')}</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('tableCaption')}</caption>
            <thead>
              <tr className="text-text-faint border-border-subtle border-b text-left">
                <th scope="col" className="py-2 pr-4 font-normal">
                  {t('columns.sosa')}
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  {t('columns.ancestor')}
                </th>
                <th scope="col" className="py-2 pr-4 font-normal">
                  {t('columns.birth')}
                </th>
                <th scope="col" className="py-2 font-normal">
                  {t('columns.before')}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.sectors.map((sector) => (
                <tr key={sector.sosa} className="border-border-subtle border-b">
                  <td className="tabular py-2 pr-4">{sector.sosa}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={personHref(sector.personId)}
                      className="text-text-primary hover:text-accent hover:underline"
                    >
                      {view.people[sector.personId]?.name}
                    </Link>
                  </td>
                  <td className="tabular py-2 pr-4">{view.people[sector.personId]?.birthLabel}</td>
                  <td className="tabular text-text-muted py-2">
                    {sector.uncertain
                      ? t('between', {
                          from: years(sector.innerYears),
                          to: years(sector.outerYears),
                        })
                      : years(sector.innerYears)}
                    {sector.anomalous ? t('inconsistent') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
