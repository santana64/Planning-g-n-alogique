import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileObjectStore } from './filesystem';

describe('the archive on disk', () => {
  let root: string;
  let store: FileObjectStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chronolignee-store-'));
    store = new FileObjectStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const bytes = new TextEncoder().encode('acte de naissance');

  it('keeps an object and gives it back byte for byte', async () => {
    await store.put('media/tree-1/abc.png', bytes, { contentType: 'image/png' });
    expect(await store.exists('media/tree-1/abc.png')).toBe(true);
    expect(new TextDecoder().decode(await store.get('media/tree-1/abc.png'))).toBe(
      'acte de naissance',
    );
    // No half-written file left beside it.
    expect(await readdir(join(root, 'media', 'tree-1'))).toEqual(['abc.png']);
  });

  it('lists and deletes a prefix, and nothing outside it', async () => {
    await store.put('media/tree-1/a.png', bytes, { contentType: 'image/png' });
    await store.put('media/tree-1/b.png', bytes, { contentType: 'image/png' });
    await store.put('media/tree-2/c.png', bytes, { contentType: 'image/png' });
    expect(await store.list('media/tree-1/')).toEqual(['media/tree-1/a.png', 'media/tree-1/b.png']);
    expect(await store.deletePrefix('media/tree-1/')).toBe(2);
    expect(await store.list('media/')).toEqual(['media/tree-2/c.png']);
  });

  it('refuses a key that would leave its directory', async () => {
    for (const key of ['../escape.txt', 'media/../../escape.txt', '']) {
      await expect(store.put(key, bytes, { contentType: 'text/plain' })).rejects.toThrow();
    }
    expect(await store.exists('../escape.txt')).toBe(false);
  });

  it('signs nothing: downloads go through the application', async () => {
    expect(await store.presignDownload('media/tree-1/a.png')).toBeNull();
  });

  it('says a missing object is missing', async () => {
    await expect(store.get('media/none.png')).rejects.toThrow(/introuvable/);
    await store.ready();
  });
});
