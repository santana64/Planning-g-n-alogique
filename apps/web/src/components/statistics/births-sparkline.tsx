import type { TreeStatistics } from '@chronolignee/genealogy';

/**
 * The shape of a family in time: births per decade, as a thin silhouette.
 *
 * Decoration with a meaning — it is the same data as the statistics chart,
 * at a size where it says only "when", and the numbers are one click away.
 * Women and men are stacked in their colours so the silhouette is not an
 * abstraction of whoever was recorded more.
 */
export function BirthsSparkline({
  decades,
  label,
}: {
  decades: TreeStatistics['birthsByDecade'];
  label: string;
}) {
  if (decades.length === 0) return null;
  const first = decades[0]?.decade ?? 0;
  const last = decades[decades.length - 1]?.decade ?? first;
  const slots = (last - first) / 10 + 1;
  const byDecade = new Map(decades.map((row) => [row.decade, row]));
  const max = Math.max(...decades.map((row) => row.female + row.male + row.other), 1);
  const width = Math.max(slots * 12, 240);
  const height = 48;
  const slot = width / slots;
  const bar = Math.max(slot * 0.7, 1);

  return (
    <figure className="flex flex-col gap-1">
      {/* Stretched to the full width on purpose: there is no text inside to
          distort, and the years are written underneath in HTML. */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-14 w-full"
        role="img"
        aria-label={label}
      >
        {Array.from({ length: slots }, (_, index) => {
          const decade = first + index * 10;
          const row = byDecade.get(decade);
          const x = index * slot;
          if (!row) return null;
          const female = (row.female / max) * height;
          const male = (row.male / max) * height;
          const other = (row.other / max) * height;
          return (
            <g key={decade} className="stat-column" style={{ animationDelay: `${index * 14}ms` }}>
              <rect
                x={x}
                y={height - female}
                width={bar}
                height={female}
                fill="var(--sex-female)"
              />
              <rect
                x={x}
                y={height - female - male}
                width={bar}
                height={male}
                fill="var(--sex-male)"
              />
              <rect
                x={x}
                y={height - female - male - other}
                width={bar}
                height={other}
                fill="var(--sex-unknown)"
              />
            </g>
          );
        })}
      </svg>
      <figcaption className="text-text-faint flex justify-between text-[11px] tabular-nums">
        <span>{first}</span>
        <span>{last}</span>
      </figcaption>
    </figure>
  );
}
