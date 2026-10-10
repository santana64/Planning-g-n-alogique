/**
 * Serves MapLibre's worker from this application's own origin.
 *
 * MapLibre parses GeoJSON — the basemap, the routes — in a web worker that it
 * loads from a URL next to its own module. Once bundled, that URL points at
 * the page instead, the server answers with HTML, and every GeoJSON layer
 * silently stays empty. So the worker and the chunk it imports are copied,
 * at the installed version, to `public/maplibre/`, and the map is told to
 * load them from there (see atlas-map.tsx).
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');

await mkdir(target, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  await copyFile(join(dist, file), join(target, file));
}
