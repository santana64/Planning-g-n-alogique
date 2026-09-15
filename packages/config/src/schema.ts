import { z } from 'zod';

/**
 * Environment schema.
 *
 * Every value the application reads from the environment is declared here and
 * parsed once at boot. A malformed DATABASE_URL should stop the process during
 * startup, not surface as a confusing runtime error under load.
 */

const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((v) => v === true || v === 'true' || v === '1');

const positiveInt = z.coerce.number().int().positive();

export const nodeEnvSchema = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof nodeEnvSchema>;

/** Flags gate experimental surfaces only. Core features are never flagged. */
export const featureFlagSchema = z.object({
  constellation: booleanFromString.default(true),
  temporalDepth: booleanFromString.default(true),
  river: booleanFromString.default(false),
  storyDirector: booleanFromString.default(false),
  webxr: booleanFromString.default(false),
  reconstruction: booleanFromString.default(false),
});
export type FeatureFlags = z.infer<typeof featureFlagSchema>;

export const serverEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    APP_URL: z.url(),
    TRUSTED_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().startsWith('postgres'),
    DATABASE_POOL_URL: z.string().startsWith('postgres').optional(),

    REDIS_URL: z.string().startsWith('redis'),

    // 32 bytes base64url is 43 chars. Anything shorter is not a real secret.
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must carry at least 32 bytes of entropy'),
    BETTER_AUTH_URL: z.url(),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: booleanFromString.default(true),
    S3_PRESIGN_TTL_SECONDS: positiveInt.max(3600).default(900),

    AI_PROVIDER: z.enum(['anthropic', 'fake']).default('fake'),
    AI_MODEL_PRIMARY: z.string().min(1).default('claude-fable-5-1'),
    AI_MODEL_FAST: z.string().min(1).default('claude-haiku-4-5-20251001'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MAX_CONCURRENCY: positiveInt.max(32).default(2),
    AI_REQUEST_TIMEOUT_MS: positiveInt.default(120_000),

    MAP_TILE_PROVIDER: z.string().default('maplibre-demo'),
    MAP_STYLE_URL: z.url().default('https://demotiles.maplibre.org/style.json'),
    MAP_TILE_API_KEY: z.string().optional(),
    GEOCODER_PROVIDER: z.enum(['none', 'nominatim']).default('none'),
    GEOCODER_API_KEY: z.string().optional(),

    MAX_UPLOAD_BYTES: positiveInt.default(52_428_800),
    MAX_IMAGE_PIXELS: positiveInt.default(50_000_000),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    OTEL_ENABLED: booleanFromString.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    SENTRY_DSN: z.string().optional(),

    FEATURE_CONSTELLATION: z.string().optional(),
    FEATURE_TEMPORAL_DEPTH: z.string().optional(),
    FEATURE_RIVER: z.string().optional(),
    FEATURE_STORY_DIRECTOR: z.string().optional(),
    FEATURE_WEBXR: z.string().optional(),
    FEATURE_RECONSTRUCTION: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Selecting the real provider without a key would fail on the first job,
    // long after deploy. Catch it at boot instead.
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY. Use AI_PROVIDER=fake locally.',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.APP_URL.startsWith('http://') && !env.APP_URL.includes('localhost')) {
        ctx.addIssue({
          code: 'custom',
          path: ['APP_URL'],
          message: 'Production APP_URL must use https: auth cookies are Secure-only.',
        });
      }
      if (env.S3_SECRET_ACCESS_KEY.includes('dev_only')) {
        ctx.addIssue({
          code: 'custom',
          path: ['S3_SECRET_ACCESS_KEY'],
          message: 'Development credentials detected in a production environment.',
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;
