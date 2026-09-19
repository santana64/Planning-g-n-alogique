import { describe, expect, it } from 'vitest';
import { maskEmail, safeReturnPath } from './mask-email';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('camille.chassagne@exemple.fr')).toBe('c•••@exemple.fr');
  });

  it('says nothing about something that is not an address', () => {
    expect(maskEmail('camille')).toBe('•••');
    expect(maskEmail('@exemple.fr')).toBe('•••');
  });
});

describe('safeReturnPath', () => {
  it('accepts the application’s own invitation and tree paths', () => {
    expect(safeReturnPath('/invitation/AbC-12_x')).toBe('/invitation/AbC-12_x');
    expect(safeReturnPath('/app/famille-chassagne/partage')).toBe('/app/famille-chassagne/partage');
    expect(safeReturnPath('/compte')).toBe('/compte');
  });

  it('refuses anything that could leave the site', () => {
    for (const value of [
      'https://evil.example/app',
      '//evil.example/app',
      '/\\evil.example',
      '/app/../../evil',
      '/app?next=https://evil.example',
      'javascript:alert(1)',
      '/sign-out',
      '',
      null,
      undefined,
    ]) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });
});
