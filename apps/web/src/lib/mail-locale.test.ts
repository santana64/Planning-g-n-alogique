import { describe, expect, it } from 'vitest';
import { localeOfRequest } from './mail-locale';

const request = (headers: Record<string, string>) =>
  new Request('https://example.test/api/auth/request-password-reset', { headers });

describe('the language of a message sent in answer to a request', () => {
  it('follows the page it was asked from', () => {
    expect(localeOfRequest(request({ referer: 'https://example.test/en/connexion' }))).toBe('en');
    expect(localeOfRequest(request({ referer: 'https://example.test/connexion' }))).toBe('fr');
    // A page under /entree is French: only the whole segment counts.
    expect(localeOfRequest(request({ referer: 'https://example.test/entree' }))).toBe('fr');
  });

  it('falls back to the locale cookie, then to French', () => {
    expect(localeOfRequest(request({ cookie: 'a=1; NEXT_LOCALE=en' }))).toBe('en');
    expect(localeOfRequest(request({ cookie: 'NEXT_LOCALE=english' }))).toBe('fr');
    expect(localeOfRequest(request({}))).toBe('fr');
    expect(localeOfRequest(undefined)).toBe('fr');
  });
});
