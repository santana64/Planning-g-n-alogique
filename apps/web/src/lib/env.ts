import 'server-only';
import { getFeatureFlags, getServerEnv } from '@chronolignee/config/server';

/**
 * Server environment.
 *
 * `server-only` makes an accidental import from a client component a build
 * error rather than a leaked secret. That import guard is the whole reason
 * this file exists instead of calling getServerEnv() at each use site.
 */
export const env = getServerEnv();
export const features = getFeatureFlags();
