import 'server-only';
import { objectStoreFromEnv } from '@chronolignee/storage';
import { env } from './env';

export const objectStore = objectStoreFromEnv(env);
