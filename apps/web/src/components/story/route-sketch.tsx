import type { AsideRoute } from './sentences';

/**
 * A move, drawn: the two places as points and the route between them
 * tracing itself across a faint graticule.
 *
 * Plate carrée within the box the two places need, which is enough to say
 * "north-west to south-west across an ocean" and claims nothing more — the
 * register gives two places, not the road between them, so the line is an
 * arc, never a path.
 */
export function RouteSketch({ route }: { route: AsideRoute }) {
  const width = 320;
  const height = 150;
  const pad = 26;
  const west = Math.min(route.from.longitude, route.to.longitude);
  const east = Math.max(route.from.longitude, route.to.longitude);
  const south = Math.min(route.from.latitude, route.to.latitude);
  const north = Math.max(route.from.latitude, route.to.latitude);
  // Never a degenerate box: a move within one town still gets a little room.
  const spanLon = Math.max(east - west, 2);
  const spanLat = Math.max(north - south, 1);
  const scale = Math.min((width - pad * 2) / spanLon, (height - pad * 2) / spanLat);
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  const project = (longitude: number, latitude: number) =>
    [width / 2 + (longitude - cx) * scale, height / 2 - (latitude - cy) * scale] as const;

  const [x1, y1] = project(route.from.longitude, route.from.latitude);
  const [x2, y2] = project(route.to.longitude, route.to.latitude);
  // The arc bows away from the centre line, by a fifth of its length.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const bow = length * 0.22;
  const nx = length === 0 ? 0 : -(y2 - y1) / length;
  const ny = length === 0 ? 0 : (x2 - x1) / length;
  const qx = mx + nx * bow;
  const qy = my + ny * bow;
  const path = `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;

  const graticule: string[] = [];
  for (let lon = Math.ceil((west - spanLon) / 10) * 10; lon <= east + spanLon; lon += 10) {
    const [x] = project(lon, cy);
    graticule.push(`M${x.toFixed(1)} 0 V${height}`);
  }
  for (let lat = Math.ceil((south - spanLat) / 10) * 10; lat <= north + spanLat; lat += 10) {
    const [, y] = project(cx, lat);
    graticule.push(`M0 ${y.toFixed(1)} H${width}`);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-2 w-full max-w-sm"
      role="img"
      aria-label={`${route.from.name} → ${route.to.name}`}
    >
      <rect width={width} height={height} rx={10} fill="#0f1730" />
      <path d={graticule.join(' ')} stroke="#2a3557" strokeWidth={0.6} fill="none" />
      <path d={path} stroke="#f0b35a" strokeOpacity={0.25} strokeWidth={6} fill="none" />
      <path
        d={path}
        stroke="#f0b35a"
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        pathLength={1}
        className="story-route"
      />
      <circle cx={x1} cy={y1} r={4} fill="#e9e4d8" />
      <circle cx={x2} cy={y2} r={5} fill="#f0b35a" className="story-route-arrival" />
      <text x={x1} y={y1 - 9} textAnchor="middle" fontSize={11} fill="#c9ccd6">
        {route.from.name}
      </text>
      <text x={x2} y={y2 + 18} textAnchor="middle" fontSize={11} fill="#f0b35a">
        {route.to.name}
      </text>
    </svg>
  );
}
