/**
 * Builds the Windows installer.
 *
 *   1. electron-builder --dir: the Electron app, unpacked;
 *   2. the staged servers added to its resources folder as three tar
 *      archives — not as ninety thousand files, which an installer writes
 *      and Windows Defender scans one by one for many minutes. The app
 *      unpacks them once, on first launch;
 *   3. electron-builder --prepackaged: the NSIS installer from that folder.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
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

// A previous build's unpacked folder would otherwise ride along. (The
// release folder itself may be some shell's working directory: kept.)
rmSync(unpacked, { recursive: true, force: true });
builder(['--win', '--dir', '--config', 'electron-builder.yml']);
const tar = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');
for (const part of ['web', 'worker', 'pgsql']) {
  const archive = join(unpacked, 'resources', `${part}.tar`);
  const result = spawnSync(tar, ['-cf', archive, '-C', stage, part], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`archiving ${part} failed`);
}
builder(['--win', 'nsis', '--prepackaged', unpacked, '--config', 'electron-builder.yml']);
