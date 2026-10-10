import { getObjectStore, type ObjectStoreLike } from './client';
import { FileObjectStore } from './filesystem';

/** The settings an object store is built from, as the environment gives them. */
export interface StorageEnv {
  readonly STORAGE_DRIVER: 's3' | 'filesystem';
  readonly STORAGE_PATH?: string | undefined;
  readonly S3_ENDPOINT: string;
  readonly S3_REGION: string;
  readonly S3_BUCKET: string;
  readonly S3_ACCESS_KEY_ID: string;
  readonly S3_SECRET_ACCESS_KEY: string;
  readonly S3_FORCE_PATH_STYLE: boolean;
  readonly S3_PRESIGN_TTL_SECONDS: number;
}

let filesystem: FileObjectStore | undefined;

/**
 * The store the configuration asks for: S3 for a server, a directory for the
 * desktop edition. One place decides, so the web app, the worker and the
 * seed can never disagree about where an archive is.
 */
export function objectStoreFromEnv(env: StorageEnv): ObjectStoreLike {
  if (env.STORAGE_DRIVER === 'filesystem') {
    if (!env.STORAGE_PATH) throw new Error('STORAGE_DRIVER=filesystem requires STORAGE_PATH');
    filesystem ??= new FileObjectStore(env.STORAGE_PATH);
    return filesystem;
  }
  return getObjectStore({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    presignTtlSeconds: env.S3_PRESIGN_TTL_SECONDS,
  });
}
