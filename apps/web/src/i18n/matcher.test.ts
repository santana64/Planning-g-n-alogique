import { describe, expect, it } from 'vitest';
import { LOCALE_MATCHER } from './matcher';

describe('locale matcher', () => {
  const regex = new RegExp(`^${LOCALE_MATCHER}$`);

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
    // If the escape had collapsed, this substring would read ".*..*" and the
    // pattern would exclude essentially every path.
    expect(LOCALE_MATCHER).toContain(String.raw`.*\..*`);
    expect(LOCALE_MATCHER).not.toContain('.*..*');
  });
});
