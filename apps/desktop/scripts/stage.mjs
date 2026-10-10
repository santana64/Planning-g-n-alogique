/**
 * Assembles what the desktop edition ships, in apps/desktop/stage:
 *
 *   web/     the Next.js standalone server, with its static files
 *   worker/  the worker as a self-contained directory (pnpm deploy, flat)
 *   pgsql/   PostgreSQL 18 with PostGIS, from scripts/fetch-postgres.mjs
 *
 * Links are resolved into real files: an installer copies files, and a
 * symbolic link to this machine's paths would point nowhere on another.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '..', '..');
const stage = join(desktop, 'stage');
const pgsql = process.env.CHRONOLIGNEE_PGSQL ?? resolve(root, '..', 'chronolignee-vendor', 'pgsql');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

if (!existsSync(join(pgsql, 'bin', 'postgres.exe'))) {
  throw new Error(
    `PostgreSQL binaries not found in ${pgsql}. Run: node apps/desktop/scripts/fetch-postgres.mjs`,
  );
}

rmSync(stage, { recursive: true, force: true });

// --- Web ---------------------------------------------------------------------
// The build evaluates server modules, and the environment schema refuses to
// load without its values: placeholders that reach nothing, as the Docker
// image uses. The running app is given the real ones by the desktop shell.
console.log('› building the web app');
run('pnpm', ['--filter', '@chronolignee/web', 'build'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: 'postgresql://placeholder/placeholder',
    APP_URL: 'http://127.0.0.1:47830',
    BETTER_AUTH_URL: 'http://127.0.0.1:47830',
    BETTER_AUTH_SECRET: 'build-time-placeholder-never-used-at-runtime-000',
    REDIS_URL: 'redis://127.0.0.1:1',
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_REGION: 'local',
    S3_BUCKET: 'local',
    S3_ACCESS_KEY_ID: 'local',
    S3_SECRET_ACCESS_KEY: 'local',
  },
});
const web = join(root, 'apps', 'web');
cpSync(join(web, '.next', 'standalone'), join(stage, 'web'), {
  recursive: true,
  dereference: true,
});
cpSync(join(web, '.next', 'static'), join(stage, 'web', 'apps', 'web', '.next', 'static'), {
  recursive: true,
});
cpSync(join(web, 'public'), join(stage, 'web', 'apps', 'web', 'public'), { recursive: true });

// pnpm keeps each package's dependencies beside it in node_modules/.pnpm and
// reaches them through links. Copied as files, those siblings are no longer
// on Node's lookup path, so the packages pnpm hoists (.pnpm/node_modules) are
// laid out at the top level as well, as a flat install would have them.
const webModules = join(stage, 'web', 'node_modules');
const hoisted = join(webModules, '.pnpm', 'node_modules');
for (const entry of readdirSync(hoisted)) {
  const names = entry.startsWith('@')
    ? readdirSync(join(hoisted, entry)).map((name) => `${entry}/${name}`)
    : [entry];
  for (const name of names) {
    const target = join(webModules, ...name.split('/'));
    if (!existsSync(target)) {
      cpSync(join(hoisted, ...name.split('/')), target, { recursive: true, dereference: true });
    }
  }
}

// --- Worker ------------------------------------------------------------------
console.log('› deploying the worker');
run(
  'pnpm',
  [
    '--filter',
    '@chronolignee/worker',
    'deploy',
    '--prod',
    '--config.node-linker=hoisted',
    join(stage, 'worker'),
  ],
  { cwd: root },
);
// Development tools a production install drags in through peer dependencies:
// the Prisma CLI and its studio, and the TypeScript compiler. The worker runs
// on the generated client and tsx; none of these is loaded at run time.
for (const dir of ['prisma', '@prisma/studio-core', '@electric-sql', 'typescript']) {
  rmSync(join(stage, 'worker', 'node_modules', ...dir.split('/')), {
    recursive: true,
    force: true,
  });
}
for (const dir of ['tests', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  rmSync(join(stage, 'worker', dir), { recursive: true, force: true });
}

// --- PostgreSQL --------------------------------------------------------------
console.log('› copying PostgreSQL');
cpSync(pgsql, join(stage, 'pgsql'), { recursive: true });

console.log(`› staged in ${stage}`);
