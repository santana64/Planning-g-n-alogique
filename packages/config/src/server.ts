import { featureFlagSchema, serverEnvSchema, type FeatureFlags, type ServerEnv } from './schema.js';

let cached: ServerEnv | undefined;

function formatIssues(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    return issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
  }
  return String(error);
}

/**
 * Parse and cache the server environment.
 *
 * Throws on the first invalid value. Callers should let it throw: a process
 * that boots with a half-valid configuration is worse than one that refuses
 * to boot.
 */
export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration.\n${formatIssues(parsed.error)}\n\n` +
        'See .env.example for the expected shape.',
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test helper — clears the memoised environment between cases. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

export function getFeatureFlags(source: NodeJS.ProcessEnv = process.env): FeatureFlags {
  return featureFlagSchema.parse({
    constellation: source['FEATURE_CONSTELLATION'] ?? undefined,
    temporalDepth: source['FEATURE_TEMPORAL_DEPTH'] ?? undefined,
    river: source['FEATURE_RIVER'] ?? undefined,
    storyDirector: source['FEATURE_STORY_DIRECTOR'] ?? undefined,
    webxr: source['FEATURE_WEBXR'] ?? undefined,
    reconstruction: source['FEATURE_RECONSTRUCTION'] ?? undefined,
  });
}

export { type ServerEnv, type FeatureFlags };
