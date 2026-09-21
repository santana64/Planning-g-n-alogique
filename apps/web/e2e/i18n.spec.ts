import { expect, test } from '@playwright/test';

/**
 * Two languages, one product.
 *
 * French is the default and has no prefix; English lives under `/en`. The
 * demonstration tree is public, so this needs no account — and a screen
 * served in French under `/en` is the bug this test exists to catch.
 */

const DEMO = 'famille-chassagne-demo';

test('serves the people list in French by default and in English under /en', async ({ page }) => {
  const main = page.locator('main');

  await page.goto(`/app/${DEMO}/personnes`);
  await expect(main.getByRole('link', { name: 'Personnes' })).toBeVisible();
  await expect(main.getByRole('searchbox', { name: 'Chercher une personne' })).toBeVisible();
  await expect(main).toContainText(/\d+ personnes/);
  await expect(main).not.toContainText('People');

  await page.goto(`/en/app/${DEMO}/personnes`);
  await expect(main.getByRole('link', { name: 'People' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Timeline' })).toBeVisible();
  await expect(main.getByRole('searchbox', { name: 'Search for a person' })).toBeVisible();
  await expect(main).toContainText(/\d+ people/);
  await expect(main).not.toContainText('personnes');

  // Asking for English once is remembered: the unprefixed address, which is
  // the French one, now answers in English for this reader. That is
  // next-intl's locale cookie doing what it is for, and it is the reason the
  // rest of this suite starts from a context that has never seen `/en`.
  await page.goto(`/app/${DEMO}/personnes`);
  await expect(main.getByRole('link', { name: 'People' })).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`/app/${DEMO}/personnes`);
  await expect(main.getByRole('link', { name: 'Personnes' })).toBeVisible();
});

test('tells a person record in English, events included', async ({ page }) => {
  await page.goto(`/en/app/${DEMO}/personnes`);
  const main = page.locator('main');
  await main
    .getByRole('link', { name: /CHASSAGNE/ })
    .first()
    .click();
  await page.waitForURL(/\/personnes\/[0-9a-f]{8}-/);

  await expect(main.getByRole('link', { name: 'All people' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Ancestry →' })).toBeVisible();
  // The kinds of event are named from the catalogue, not from a French map
  // baked into the server.
  await expect(main).toContainText('Birth');
  await expect(main).not.toContainText('Naissance');
  await expect(main).not.toContainText('Liens');
});

test('says in either language that nothing matched', async ({ page }) => {
  const main = page.locator('main');

  await page.goto(`/app/${DEMO}/personnes?q=zzzz`);
  await expect(main).toContainText('Aucun nom ne correspond.');

  await page.goto(`/en/app/${DEMO}/personnes?q=zzzz`);
  await expect(main).toContainText('No name matches.');
});
