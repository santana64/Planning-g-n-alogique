import { useTranslations } from 'next-intl';
import { branchColorForKey } from '@chronolignee/ui';

/**
 * The opening scene.
 *
 * Not decoration: it is the product's thesis rendered in about eighty lines.
 * Lives are horizontal intervals on a shared time axis, relationships are
 * links drawn at the moment they occurred, and the edges say what is actually
 * known — a hard cap for a recorded date, a taper for an approximate one, a
 * fade where nothing is recorded at all.
 *
 * Deliberately SVG and CSS rather than the WebGPU engine. A first-time visitor
 * must see the idea before a renderer could even finish booting, and marketing
 * motion must never stand between someone and the application.
 *
 * The family is fictional (see docs/PRIVACY.md — no real private individuals
 * anywhere in the product's demo material).
 */

interface Life {
  readonly id: string;
  readonly name: string;
  readonly birth: number;
  /** Null when no death is recorded: the line fades instead of ending. */
  readonly death: number | null;
  /** True when the birth year is approximate, e.g. "vers 1812". */
  readonly birthApproximate?: boolean;
  readonly deathApproximate?: boolean;
  /** Still living: the line runs to today and stops there honestly. */
  readonly living?: boolean;
  readonly branch: string;
  readonly parents?: readonly string[];
}

const LIVES: readonly Life[] = [
  { id: 'antoine', name: 'Antoine', birth: 1779, death: 1836, branch: 'a' },
  { id: 'elisabeth', name: 'Élisabeth', birth: 1782, death: 1841, branch: 'a' },
  { id: 'jean', name: 'Jean', birth: 1810, death: 1877, branch: 'a', parents: ['antoine'] },
  {
    id: 'pierre',
    name: 'Pierre',
    birth: 1812,
    death: 1868,
    birthApproximate: true,
    branch: 'b',
    parents: ['elisabeth'],
  },
  { id: 'marie', name: 'Marie', birth: 1815, death: 1889, branch: 'b' },
  { id: 'auguste', name: 'Auguste', birth: 1843, death: 1912, branch: 'a', parents: ['jean'] },
  {
    id: 'henriette',
    name: 'Henriette',
    birth: 1851,
    death: null,
    branch: 'b',
    parents: ['pierre'],
  },
  { id: 'louise', name: 'Louise', birth: 1876, death: 1954, branch: 'a', parents: ['auguste'] },
  { id: 'emile', name: 'Émile', birth: 1879, death: 1917, branch: 'b', parents: ['henriette'] },
  { id: 'robert', name: 'Robert', birth: 1908, death: 1991, branch: 'a', parents: ['louise'] },
  {
    id: 'suzanne',
    name: 'Suzanne',
    birth: 1912,
    death: 2003,
    deathApproximate: true,
    branch: 'c',
    parents: ['emile'],
  },
  {
    id: 'claire',
    name: 'Claire',
    birth: 1947,
    death: null,
    living: true,
    branch: 'a',
    parents: ['robert'],
  },
  {
    id: 'thomas',
    name: 'Thomas',
    birth: 1974,
    death: null,
    living: true,
    branch: 'c',
    parents: ['suzanne'],
  },
];

const FROM_YEAR = 1770;
const TO_YEAR = 2040;
const TODAY_YEAR = 2026;

const WIDTH = 1200;
const ROW_HEIGHT = 30;
const TOP = 34;
const HEIGHT = TOP + LIVES.length * ROW_HEIGHT + 22;

/**
 * Space reserved for names to the left of the plot. Without it the earliest
 * lives start at x=0 and their labels are clipped by the viewBox — which is
 * exactly what happened before this constant existed.
 */
const LEFT_GUTTER = 96;
const PLOT_WIDTH = WIDTH - LEFT_GUTTER;

const x = (year: number): number =>
  LEFT_GUTTER + ((year - FROM_YEAR) / (TO_YEAR - FROM_YEAR)) * PLOT_WIDTH;
const y = (index: number): number => TOP + index * ROW_HEIGHT;

const DECADE_MARKS = [1800, 1850, 1900, 1950, 2000];

export function OpeningTimeline() {
  const t = useTranslations('landing');
  const indexById = new Map(LIVES.map((life, i) => [life.id, i]));

  return (
    <figure className="border-border-subtle bg-surface-sunken overflow-hidden rounded-[var(--radius-lg)] border">
      {/* Scrolls inside itself rather than shrinking.
       *
       * Below roughly 820px the names become illegible if the drawing is
       * squeezed to fit, and an illegible timeline communicates nothing. The
       * page body never scrolls sideways; this container does. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-auto w-full min-w-[820px]"
          role="img"
          aria-labelledby="opening-title opening-desc"
        >
          <title id="opening-title">{t('figureTitle')}</title>
          {/* The canvas has a parallel description, because a visualisation that
            only exists as pixels is unavailable to a screen reader. The real
            application goes further and offers a navigable HTML tree. */}
          <desc id="opening-desc">{t('figureDescription')}</desc>

          <defs>
            {/* Reveal clips. Each line is uncovered left to right by scaling a
             * rectangle, which leaves stroke-dasharray free to carry meaning
             * instead of being consumed by the draw animation. */}
            {LIVES.map((life, index) => {
              const start = x(life.birth);
              const end = x(life.death ?? (life.living ? TODAY_YEAR : life.birth + 70));
              return (
                <clipPath key={`reveal-${life.id}`} id={`reveal-${life.id}`}>
                  <rect
                    x={start}
                    y={y(index) - 6}
                    width={Math.max(end - start, 2)}
                    height={12}
                    className="life-reveal"
                    style={{ '--delay': `${0.8 + index * 0.07}s` } as React.CSSProperties}
                  />
                </clipPath>
              );
            })}

            {/* One fade gradient per open-ended life, in user space.
             *
             * The default objectBoundingBox units are unusable here: a horizontal
             * <line> has a zero-height bounding box, so the gradient degenerates
             * and the stroke vanishes entirely. Explicit coordinates are the fix.
             *
             * A fade rather than a cap, because a life with no recorded death
             * must not appear to end at a date we picked. */}
            {LIVES.map((life, index) => {
              if (life.death !== null || life.living) return null;
              const start = x(life.birth);
              const end = x(life.birth + 70);
              return (
                <linearGradient
                  key={`fade-${life.id}`}
                  id={`fade-${life.id}`}
                  gradientUnits="userSpaceOnUse"
                  x1={start}
                  y1={y(index)}
                  x2={end}
                  y2={y(index)}
                >
                  <stop
                    offset="0%"
                    stopColor={branchColorForKey(life.branch).base}
                    stopOpacity="1"
                  />
                  <stop
                    offset="45%"
                    stopColor={branchColorForKey(life.branch).base}
                    stopOpacity="0.8"
                  />
                  <stop
                    offset="100%"
                    stopColor={branchColorForKey(life.branch).base}
                    stopOpacity="0"
                  />
                </linearGradient>
              );
            })}
          </defs>

          {DECADE_MARKS.map((year) => (
            <g key={year}>
              <line
                x1={x(year)}
                y1={18}
                x2={x(year)}
                y2={HEIGHT - 16}
                stroke="var(--border-subtle)"
                strokeWidth="1"
              />
              <text
                x={x(year) + 5}
                y={14}
                fill="var(--text-faint)"
                fontSize="10"
                className="tabular"
              >
                {year}
              </text>
            </g>
          ))}

          {/* Today. The one vertical the eye should find first, because every
            "is this person still alive" question resolves against it. */}
          <line
            x1={x(TODAY_YEAR)}
            y1={18}
            x2={x(TODAY_YEAR)}
            y2={HEIGHT - 16}
            stroke="var(--accent-primary)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.5"
          />

          {/* Relationship links, drawn at the child's birth year: the moment the
            relationship began, not an arbitrary midpoint. */}
          {LIVES.flatMap((life, childIndex) =>
            (life.parents ?? []).map((parentId) => {
              const parentIndex = indexById.get(parentId);
              if (parentIndex === undefined) return null;
              const px = x(life.birth);
              const py = y(parentIndex);
              const cy = y(childIndex);
              return (
                <path
                  key={`${parentId}-${life.id}`}
                  d={`M ${px} ${py} C ${px} ${py + (cy - py) * 0.5}, ${px} ${cy - (cy - py) * 0.5}, ${px} ${cy}`}
                  stroke="var(--border-strong)"
                  strokeWidth="1.25"
                  fill="none"
                  className="life-connector"
                  style={{ '--delay': `${1.0 + childIndex * 0.05}s` } as React.CSSProperties}
                />
              );
            }),
          )}

          {LIVES.map((life, index) => {
            const color = branchColorForKey(life.branch).base;
            const start = x(life.birth);
            // A life with no recorded death does not end at a date we invented.
            // It runs to today when the person is living, and fades otherwise.
            const rawEnd = life.death ?? (life.living ? TODAY_YEAR : life.birth + 70);
            const end = x(rawEnd);
            const unknownEnd = life.death === null && !life.living;

            return (
              <g key={life.id}>
                <line
                  x1={start}
                  y1={y(index)}
                  x2={end}
                  y2={y(index)}
                  stroke={unknownEnd ? `url(#fade-${life.id})` : color}
                  strokeWidth="3.5"
                  // A rounded cap softens an approximate birth; a butt cap is the
                  // hard edge a recorded date has earned.
                  strokeLinecap={life.birthApproximate ? 'round' : 'butt'}
                  strokeDasharray={life.deathApproximate ? '9 3' : undefined}
                  clipPath={`url(#reveal-${life.id})`}
                />
                <text
                  x={start - 6}
                  y={y(index) + 3.5}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="11"
                  fontFamily="var(--font-serif)"
                  className="rise"
                  style={{ '--delay': `${1.0 + index * 0.07}s` } as React.CSSProperties}
                >
                  {life.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <figcaption className="border-border-subtle text-text-faint flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-4 py-2.5 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-certain h-0.5 w-5" />
          {t('recordedDate')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-0.5 w-5"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, var(--certainty-approximate) 0 6px, transparent 6px 9px)',
            }}
          />
          {t('approximateDate')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-0.5 w-5"
            style={{
              backgroundImage: 'linear-gradient(90deg, var(--certainty-inferred), transparent)',
            }}
          />
          {t('unknownEnd')}
        </span>
      </figcaption>
    </figure>
  );
}
