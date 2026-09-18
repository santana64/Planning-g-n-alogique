import { describe, expect, it } from 'vitest';
import { assertDeployable, isLocalAddress, serverEnvSchema } from './schema';

/**
 * The checks that stand between a configuration and production.
 *
 * They went uncalled for several phases, which is the failure this file
 * guards against in the other direction: now that they run at start-up, they
 * must refuse exactly what they should, and let a local production build —
 * the end-to-end suite, a container smoke test — run with development values.
 */

const BASE = {
  NODE_ENV: 'production',
  APP_URL: 'https://genealogie.example.org',
  TRUSTED_ORIGINS: 'https://genealogie.example.org',
  BETTER_AUTH_URL: 'https://genealogie.example.org',
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  DATABASE_URL: 'postgresql://app:strong@db.internal:5432/chronolignee',
  REDIS_URL: 'redis://cache.internal:6379',
  S3_ENDPOINT: 'https://s3.internal',
  S3_REGION: 'eu-west-3',
  S3_BUCKET: 'archives',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'a-real-secret',
  AI_PROVIDER: 'none',
};

function env(overrides: Record<string, string> = {}) {
  return serverEnvSchema.parse({ ...BASE, ...overrides });
}

describe('a real deployment', () => {
  it('starts with a safe configuration and AI turned off', () => {
    // "none" is the honest setting for an instance without a key: the tree
    // does not depend on a paid API to exist.
    expect(() => assertDeployable(env())).not.toThrow();
  });

  it('refuses the AI test double', () => {
    // A regular expression's output presented as a reading of a register.
    expect(() => assertDeployable(env({ AI_PROVIDER: 'fake' }))).toThrow(/AI_PROVIDER=fake/);
  });

  it('refuses plain http', () => {
    expect(() => assertDeployable(env({ APP_URL: 'http://genealogie.example.org' }))).toThrow(
      /https/,
    );
  });

  it('refuses the development database credential', () => {
    expect(() =>
      assertDeployable(
        env({ DATABASE_URL: 'postgresql://chronolignee:chronolignee_dev_only@db:5432/x' }),
      ),
    ).toThrow(/DATABASE_URL/);
  });

  it('lists every problem at once rather than one per restart', () => {
    let message = '';
    try {
      assertDeployable(env({ AI_PROVIDER: 'fake', S3_SECRET_ACCESS_KEY: 'minio_dev_only_secret' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('AI_PROVIDER');
    expect(message).toContain('S3_SECRET_ACCESS_KEY');
  });
});

describe('a local production build', () => {
  it('runs with development values when its own address is localhost', () => {
    // The end-to-end suite runs `next start` — NODE_ENV=production — against
    // the local database and the AI test double. That is testing, not serving.
    expect(() =>
      assertDeployable(
        env({
          APP_URL: 'http://localhost:3100',
          AI_PROVIDER: 'fake',
          DATABASE_URL: 'postgresql://chronolignee:chronolignee_dev_only@localhost:5434/x',
        }),
      ),
    ).not.toThrow();
  });

  it('is not skipped in development either way', () => {
    expect(() =>
      assertDeployable(env({ NODE_ENV: 'development', AI_PROVIDER: 'fake' })),
    ).not.toThrow();
  });
});

describe('what counts as local', () => {
  it.each([
    ['http://localhost:3000', true],
    ['http://app.localhost:3000', true],
    ['http://127.0.0.1:3000', true],
    ['http://[::1]:3000', true],
    ['https://genealogie.example.org', false],
    // A name that merely contains the word is not this machine.
    ['https://localhost.example.org', false],
    ['https://notlocalhost.org', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isLocalAddress(url)).toBe(expected);
  });
});
