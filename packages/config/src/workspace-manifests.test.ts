import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every workspace package is known to the container builds.
 *
 * The Dockerfiles copy each package.json individually before installing, so
 * the dependency layer is cached until a manifest actually changes. The price
 * is a list that has to be kept in step by hand: add a package, forget the
 * Dockerfiles, and `pnpm install --frozen-lockfile` fails inside the image
 * build — which nothing on a developer machine runs. It happened with the AI
 * package. This makes it a failing unit test instead of a failing deploy.
 *
 * Reads two files and a directory listing; no network, no database.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function workspacePackages(): string[] {
  const found: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(ROOT, group))) {
      if (existsSync(join(ROOT, group, name, 'package.json'))) found.push(`${group}/${name}`);
    }
  }
  return found.sort();
}

describe.each(['infra/docker/web.Dockerfile', 'infra/docker/worker.Dockerfile'])(
  '%s',
  (dockerfile) => {
    const content = readFileSync(join(ROOT, dockerfile), 'utf8');

    it.each(workspacePackages())('copies the manifest of %s before installing', (pkg) => {
      expect(content, `${dockerfile} does not copy ${pkg}/package.json`).toContain(
        `COPY ${pkg}/package.json ./${pkg}/`,
      );
    });
  },
);
