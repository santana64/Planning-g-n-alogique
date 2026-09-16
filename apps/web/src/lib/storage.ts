import 'server-only';
import { getObjectStore } from '@chronolignee/storage';
import { env } from './env';

export const objectStore = getObjectStore({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  presignTtlSeconds: env.S3_PRESIGN_TTL_SECONDS,
});
