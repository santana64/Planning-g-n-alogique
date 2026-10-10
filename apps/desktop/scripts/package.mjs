/**
 * Builds the Windows installer.
 *
 *   1. electron-builder --dir: the Electron app, unpacked;
 *   2. the staged servers copied into its resources folder, node_modules
 *      included (electron-builder will not copy those itself);
 *   3. electron-builder --prepackaged: the NSIS installer from that folder.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(desktop, 'stage');
const unpacked = join(desktop, 'release', 'win-unpacked');

function builder(args) {
  const result = spawnSync('pnpm', ['exec', 'electron-builder', ...args], {
    cwd: desktop,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) throw new Error(`electron-builder ${args.join(' ')} failed`);
}

for (const part of ['web', 'worker', 'pgsql']) {
  if (!existsSync(join(stage, part)))
    throw new Error(`stage/${part} is missing: run the stage script`);
}

builder(['--win', '--dir', '--config', 'electron-builder.yml']);
for (const part of ['web', 'worker', 'pgsql']) {
  cpSync(join(stage, part), join(unpacked, 'resources', part), { recursive: true });
}
builder(['--win', 'nsis', '--prepackaged', unpacked, '--config', 'electron-builder.yml']);
