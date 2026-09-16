import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

/**
 * Build the bundled basemap.
 *
 * The map ships its own geometry rather than pointing at a tile provider, for
 * two reasons. A tile URL needs an API key, which is a credential this project
 * cannot generate and a dependency a self-hosted instance should not inherit;
 * and street-level detail would imply a precision the data does not have — an
 * 1830 baptism is recorded in a commune, not at a street corner.
 *
 * Natural Earth at 1:110m is public domain and about the right resolution:
 * coastlines and borders, nothing that pretends to more.
 *
 * Run with `pnpm --filter @chronolignee/web basemap`. The output is committed,
 * so a build never depends on this script or on the network.
 */

const require = createRequire(import.meta.url);
const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/basemap/countries-110m.geojson',
);

const topology = JSON.parse(
  await readFile(require.resolve('world-atlas/countries-110m.json'), 'utf8'),
);
const collection = feature(topology, topology.objects.countries);

/** Coordinates to five decimals: about a metre, and far past what 110m data holds. */
function round(value) {
  if (Array.isArray(value)) return value.map(round);
  return typeof value === 'number' ? Math.round(value * 1e5) / 1e5 : value;
}

const trimmed = {
  type: 'FeatureCollection',
  features: collection.features.map((f) => ({
    type: 'Feature',
    // Only the name is kept. The rest of Natural Earth's attribute table is
    // several hundred kilobytes the browser would download and never read.
    properties: { name: f.properties?.name ?? '' },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  })),
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(trimmed));

const bytes = JSON.stringify(trimmed).length;
process.stdout.write(
  `${trimmed.features.length} countries, ${(bytes / 1024).toFixed(0)} kB -> ${OUTPUT}\n`,
);
