import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ObjectStore,
  buildDerivedKey,
  buildObjectKey,
  checksum,
  safeDownloadName,
  treePrefixes,
  validateGedcom,
  validateUpload,
} from '../src/index';

/**
 * Object storage against the real MinIO from docker-compose.
 *
 * The interesting behaviours here — presigned URLs, prefix deletion, what an
 * S3 backend does with an accented Content-Disposition — exist only in the
 * service. A mocked S3 client would assert that our assumptions are
 * self-consistent, which is not the question worth asking.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let store: ObjectStore;
const treeId = `test-${Date.now()}`;
const writtenKeys: string[] = [];

/** A one-pixel PNG, as real bytes. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

beforeAll(() => {
  store = new ObjectStore({
    endpoint: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: process.env['S3_BUCKET'] ?? 'chronolignee-archives',
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? 'chronolignee',
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? 'chronolignee_dev_only',
    forcePathStyle: true,
    presignTtlSeconds: 900,
  });
}, 30_000);

afterAll(async () => {
  for (const prefix of treePrefixes(treeId)) {
    await store.deletePrefix(prefix).catch(() => undefined);
  }
});

describe('round trip', () => {
  it('stores and reads back the exact bytes', async () => {
    const key = buildObjectKey(treeId, 'document', 'png');
    writtenKeys.push(key);

    await store.put(key, PNG, { contentType: 'image/png', checksum: checksum(PNG) });
    const read = await store.get(key);

    expect(read.byteLength).toBe(PNG.byteLength);
    expect(checksum(read)).toBe(checksum(PNG));
  });

  it('reports a missing object rather than inventing one', async () => {
    expect(await store.exists(`documents/${treeId}/does-not-exist.png`)).toBe(false);
  });

  it('accepts an accented download name', async () => {
    // A French archive filename is the normal case, not the edge case. If the
    // header encoding is wrong the upload fails outright rather than silently
    // arriving as mojibake.
    const key = buildObjectKey(treeId, 'document', 'png');
    writtenKeys.push(key);
    await store.put(key, PNG, {
      contentType: 'image/png',
      downloadName: 'Acte de naissance — Élisabeth Lefèvre.png',
    });
    expect(await store.exists(key)).toBe(true);
  });
});

describe('presigned links', () => {
  it('issues a URL that actually fetches the object', async () => {
    const key = buildObjectKey(treeId, 'document', 'png');
    writtenKeys.push(key);
    await store.put(key, PNG, { contentType: 'image/png' });

    const url = await store.presignDownload(key, 120);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(PNG.byteLength);
  });

  it('keeps the bucket private to anyone without a signature', async () => {
    const key = buildObjectKey(treeId, 'document', 'png');
    writtenKeys.push(key);
    await store.put(key, PNG, { contentType: 'image/png' });

    // The same object without the signature. A family's archival documents
    // must not be readable by anyone who guesses a URL.
    const url = await store.presignDownload(key, 120);
    const unsigned = url.split('?')[0] ?? url;
    expect((await fetch(unsigned)).status).toBeGreaterThanOrEqual(400);
  });
});

describe('prefix deletion', () => {
  it('removes everything belonging to one tree', async () => {
    const scratchTree = `scratch-${Date.now()}`;
    for (let i = 0; i < 3; i += 1) {
      await store.put(buildObjectKey(scratchTree, 'media', 'png'), PNG, {
        contentType: 'image/png',
      });
    }

    const prefix = `media/${scratchTree}/`;
    expect(await store.list(prefix)).toHaveLength(3);

    // This is what makes account deletion finishable rather than aspirational.
    expect(await store.deletePrefix(prefix)).toBe(3);
    expect(await store.list(prefix)).toHaveLength(0);
  });
});

describe('keys', () => {
  it('never puts the user filename in the key', () => {
    const key = buildObjectKey(treeId, 'document', 'png');
    expect(key).not.toContain('acte');
    expect(key).toMatch(/^documents\/[^/]+\/[0-9a-f]{32}\.png$/);
  });

  it('gives two uploads of the same name different keys', () => {
    // Everyone's scan is called acte.jpg.
    expect(buildObjectKey(treeId, 'document', 'jpg')).not.toBe(
      buildObjectKey(treeId, 'document', 'jpg'),
    );
  });

  it('places a derived object beside its original', () => {
    const original = 'documents/tree/abc123.pdf';
    expect(buildDerivedKey(original, 'thumb', 'webp')).toBe('documents/tree/abc123.thumb.webp');
  });

  it('strips characters that mean something in a header or a path', () => {
    expect(safeDownloadName('../../etc/passwd')).toBe('....etcpasswd');
    expect(safeDownloadName('acte"; rm -rf /.jpg')).toBe('acte rm -rf .jpg');
    expect(safeDownloadName('   ')).toBe('document');
  });

  it('keeps accents, which are ordinary in French archives', () => {
    expect(safeDownloadName('Élisabeth Lefèvre.pdf')).toBe('Élisabeth Lefèvre.pdf');
  });
});

describe('validation reads the bytes, not the claim', () => {
  it('accepts a real PNG', async () => {
    const result = await validateUpload(PNG, { maxBytes: 1_000_000 });
    expect(result).toMatchObject({ ok: true, mime: 'image/png', category: 'image' });
  });

  it('refuses a file whose bytes are not what it claims', async () => {
    // A script renamed to .png, declared as an image. The declaration is a
    // suggestion from an untrusted source; the magic numbers are not.
    const script = new TextEncoder().encode('#!/bin/sh\nrm -rf /\n');
    const result = await validateUpload(script, {
      maxBytes: 1_000_000,
      declaredMime: 'image/png',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('UNRECOGNISED_TYPE');
  });

  it('refuses an empty file', async () => {
    const result = await validateUpload(new Uint8Array(0), { maxBytes: 1000 });
    expect(result.ok).toBe(false);
  });

  it('refuses a file over the limit before reading it', async () => {
    const result = await validateUpload(PNG, { maxBytes: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TOO_LARGE');
  });

  it('identifies GEDCOM by its header, since text has no magic number', () => {
    const gedcom = new TextEncoder().encode('0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n0 TRLR\r\n');
    expect(validateGedcom(gedcom, 1_000_000)).toMatchObject({ ok: true, category: 'gedcom' });
  });

  it('refuses text that is not GEDCOM', () => {
    const notGedcom = new TextEncoder().encode('Ceci est une lettre de 1912.');
    expect(validateGedcom(notGedcom, 1_000_000).ok).toBe(false);
  });

  it('accepts a GEDCOM with a byte-order mark', () => {
    const withBom = new TextEncoder().encode('﻿0 HEAD\r\n0 TRLR\r\n');
    expect(validateGedcom(withBom, 1_000_000).ok).toBe(true);
  });
});
