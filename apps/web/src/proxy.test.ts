import { describe, expect, it, vi } from 'vitest';

// Only the middleware factory is stubbed. `config` still comes from the real
// module, so the test asserts the value that actually ships rather than a copy
// of it that could drift.
vi.mock('next-intl/middleware', () => ({ default: () => () => undefined }));

const { config } = await import('./proxy');

describe('locale matcher', () => {
  const pattern = config.matcher[0] as string;
  const regex = new RegExp(`^${pattern}$`);

  it.each(['/', '/fr', '/en', '/fr/sign-in', '/fr/arbre/dupont', '/en/recherche'])(
    'routes %s through locale negotiation',
    (path) => {
      expect(regex.test(path)).toBe(true);
    },
  );

  it.each([
    '/api/auth/session',
    '/api/auth/sign-in/email',
    '/_next/static/chunk.js',
    '/_vercel/insights',
    '/logo.svg',
    '/favicon.ico',
    '/documents/acte.pdf',
  ])('leaves %s alone', (path) => {
    expect(regex.test(path)).toBe(false);
  });

  it('escapes the dot rather than letting it match any character', () => {
    // If the escape had collapsed, the pattern would read ".*..*" and would
    // exclude essentially every path from locale handling.
    expect(pattern).toContain(String.raw`.*\..*`);
    expect(pattern).not.toContain('.*..*');
  });
});
