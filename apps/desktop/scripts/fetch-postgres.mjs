/**
 * Fetches PostgreSQL 18 and PostGIS for Windows, and lays them out as the
 * desktop edition ships them.
 *
 *   node apps/desktop/scripts/fetch-postgres.mjs [target-directory]
 *
 * Sources: EnterpriseDB's binary archive (the distribution postgresql.org
 * points Windows users to) and OSGeo's PostGIS bundle. Each archive is
 * checked against the size and SHA-256 recorded below before anything is
 * extracted. Those digests were computed from the archives as first
 * downloaded (2026-10-10), not published by the vendors: they guarantee
 * every later build uses the same bytes, not that the first download was
 * genuine — it came over HTTPS from the vendors' own hosts.
 *
 * pgAdmin, StackBuilder, documentation and headers are left out.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  cpSync,
  renameSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ARCHIVES = [
  {
    name: 'postgresql-18.6-1-windows-x64-binaries.zip',
    url: 'https://get.enterprisedb.com/postgresql/postgresql-18.6-1-windows-x64-binaries.zip',
    bytes: 343_808_005,
    sha256: 'fbe23da234ee31547bf8a36d29dfd81e82b849df2d2b78d2eecb43d360252f8c',
  },
  {
    name: 'postgis-bundle-pg18-3.6.2x64.zip',
    url: 'https://download.osgeo.org/postgis/windows/pg18/postgis-bundle-pg18-3.6.2x64.zip',
    bytes: 124_037_332,
    sha256: '0f41241cc536f7404dda43fd2a3f20ffe1fa1d71a8d4f6341428cd25931bf419',
  },
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const vendor = resolve(process.argv[2] ?? join(root, '..', 'chronolignee-vendor'));
const downloads = join(vendor, 'downloads');
mkdirSync(downloads, { recursive: true });

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

for (const archive of ARCHIVES) {
  const path = join(downloads, archive.name);
  if (!existsSync(path) || statSync(path).size !== archive.bytes) {
    console.log(`› downloading ${archive.name}`);
    const response = await globalThis.fetch(archive.url);
    if (!response.ok || !response.body) throw new Error(`${archive.url}: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${path}.part`));
    renameSync(`${path}.part`, path);
  }
  const digest = await sha256(path);
  if (statSync(path).size !== archive.bytes || digest !== archive.sha256) {
    throw new Error(`${archive.name} does not match its recorded size and SHA-256; not extracting`);
  }
}

const unzip = (archive, into) => {
  const result = spawnSync('tar', ['-xf', join(downloads, archive), '-C', into], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`extracting ${archive} failed`);
};

const work = join(vendor, 'extract');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
console.log('› extracting');
unzip(ARCHIVES[0].name, work);
unzip(ARCHIVES[1].name, work);

const pg = join(work, 'pgsql');
for (const unused of ['pgAdmin 4', 'StackBuilder', 'doc', 'include', 'symbols']) {
  rmSync(join(pg, unused), { recursive: true, force: true });
}
const bundle = join(work, 'postgis-bundle-pg18-3.6.2x64');
for (const part of ['bin', 'lib', 'share']) {
  cpSync(join(bundle, part), join(pg, part), { recursive: true, force: false });
}
cpSync(join(bundle, 'gdal-data'), join(pg, 'share', 'gdal-data'), { recursive: true });
mkdirSync(join(pg, 'licenses'), { recursive: true });
for (const file of ['LICENSE', 'COPYRIGHT.pg_sphere']) {
  if (existsSync(join(bundle, file))) cpSync(join(bundle, file), join(pg, 'licenses', file));
}

const target = join(vendor, 'pgsql');
rmSync(target, { recursive: true, force: true });
renameSync(pg, target);
rmSync(work, { recursive: true, force: true });
console.log(`› PostgreSQL with PostGIS ready in ${target}`);
