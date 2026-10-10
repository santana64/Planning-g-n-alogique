import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object storage.
 *
 * S3-compatible, so the same code runs against MinIO locally and AWS S3,
 * Cloudflare R2 or anything else in production. Nothing above this module
 * knows which.
 *
 * Objects are private. A family's archival documents are not public URLs, and
 * every read goes through a presigned link that is issued only after the
 * caller has been authorised — the authorisation happens above, and this
 * module is deliberately incapable of making that decision itself, so it
 * cannot be the place where someone forgets to.
 */

export interface StorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** MinIO needs path-style addressing; most cloud providers do not. */
  readonly forcePathStyle: boolean;
  readonly presignTtlSeconds: number;
}

export interface PutOptions {
  readonly contentType: string;
  /** Kept so a download can be offered under the name the user recognises. */
  readonly downloadName?: string;
  readonly checksum?: string;
}

/** What the application needs from an object store, whatever holds the bytes. */
export interface ObjectStoreLike {
  put(key: string, body: Uint8Array, options: PutOptions): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  ready(): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** A time-limited link, or null when the store cannot sign one. */
  presignDownload(key: string, ttlSeconds?: number): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<number>;
}

export class ObjectStore implements ObjectStoreLike {
  private readonly client: S3Client;
  private readonly config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ...(options.downloadName
          ? {
              // RFC 5987 encoding, so an accented French filename survives the
              // header intact instead of arriving as mojibake.
              ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(options.downloadName)}`,
            }
          : {}),
        ...(options.checksum ? { Metadata: { sha256: options.checksum } } : {}),
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Objet vide ou introuvable : ${key}`);
    return new Uint8Array(await response.Body.transformToByteArray());
  }

  /** Whether the bucket answers, for a readiness probe. Throws when it does not. */
  async ready(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A time-limited download link.
   *
   * The caller must already have checked that this viewer may read this
   * object. There is no way to ask that question from here, on purpose: a
   * storage layer that could authorise would eventually be asked to.
   */
  async presignDownload(key: string, ttlSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: ttlSeconds ?? this.config.presignTtlSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  /** Every key under a prefix, paging through the listing. */
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  /**
   * Delete everything under a prefix.
   *
   * Used by tree and account deletion. Listing then deleting one at a time is
   * slower than a batch delete and is what makes a partial failure resumable:
   * whatever was removed stays removed, and a second run finishes the job.
   */
  async deletePrefix(prefix: string): Promise<number> {
    const keys = await this.list(prefix);
    for (const key of keys) await this.delete(key);
    return keys.length;
  }
}

let shared: ObjectStoreLike | undefined;

/** Memoised store, so hot reload does not open a client per edit. */
export function getObjectStore(config: StorageConfig): ObjectStoreLike {
  shared ??= new ObjectStore(config);
  return shared;
}
