import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ObjectStoreLike, PutOptions } from './client';

/**
 * Objects as files in one directory — for the desktop edition, where there
 * is no object store to talk to and the archive lives on the user's disk.
 *
 * The same contract as the S3 store: random keys chosen by the application
 * (never a user's filename), originals never rewritten, a prefix deleted as a
 * whole when a tree goes. A key is resolved inside the root and refused if it
 * would leave it: keys are built by `buildObjectKey`, but a store that trusts
 * its keys is one bug away from writing anywhere on the disk.
 *
 * There is no presigned URL here; downloads go through the application's own
 * routes, which check access first, exactly as they do before presigning.
 */
export class FileObjectStore implements ObjectStoreLike {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    const full = resolve(this.root, ...key.split('/'));
    const inside = relative(this.root, full);
    if (
      !inside ||
      inside.startsWith('..') ||
      inside.includes(`..${sep}`) ||
      resolve(full) !== full
    ) {
      throw new Error('object key outside the store');
    }
    return full;
  }

  async put(key: string, body: Uint8Array, _options: PutOptions): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    // Written beside, then moved into place: a crash mid-write leaves a stray
    // temporary file, never a truncated original.
    const temporary = `${path}.${process.pid}.${Date.now()}.part`;
    await writeFile(temporary, body);
    await rename(temporary, path);
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.pathOf(key)));
    } catch {
      throw new Error(`Objet vide ou introuvable : ${key}`);
    }
  }

  async ready(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await stat(this.root);
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(key))).isFile();
    } catch {
      return false;
    }
  }

  /** No signed URL on a disk: the caller serves the bytes itself. */
  async presignDownload(_key: string, _ttlSeconds?: number): Promise<string | null> {
    return null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!entry.name.endsWith('.part')) {
          keys.push(relative(this.root, full).split(sep).join('/'));
        }
      }
    };
    await walk(this.root);
    return keys.filter((key) => key.startsWith(prefix)).sort();
  }

  async deletePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    for (const key of keys) await this.delete(key);
    return keys.length;
  }
}
