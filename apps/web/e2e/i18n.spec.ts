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

test('serves the timeline, the map and the archive in English', async ({ page }) => {
  await page.goto('/en/demo');
  await expect(page.getByRole('button', { name: 'Show the table' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Travel in time' })).toBeVisible();

  const main = page.locator('main');
  await page.goto(`/en/app/${DEMO}/carte`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Map');
  await expect(main).not.toContainText('Carte');

  await page.goto(`/en/app/${DEMO}/archives`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Archive');
  await expect(main).toContainText('of the events are sourced');
  await expect(main).not.toContainText('sourcés');
});

test('says in either language that nothing matched', async ({ page }) => {
  const main = page.locator('main');

  await page.goto(`/app/${DEMO}/personnes?q=zzzz`);
  await expect(main).toContainText('Aucun nom ne correspond.');

  await page.goto(`/en/app/${DEMO}/personnes?q=zzzz`);
  await expect(main).toContainText('No name matches.');
});

test('tells a suggested story in English, from the same facts', async ({ page }) => {
  await page.goto(`/en/app/${DEMO}/recits`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Suggested stories');
  await expect(page.getByRole('heading', { name: 'From Tours to Buenos Aires' })).toBeVisible();
  await page.getByRole('button', { name: 'Read “From Tours to Buenos Aires”' }).click();
  const player = page.getByRole('dialog', { name: 'From Tours to Buenos Aires' });
  await expect(player).toContainText('Starting point');
  await expect(player).toContainText(/Born on \d{1,2} [A-Z][a-z]+ \d{4} in Buenos Aires\./);
  await expect(player).not.toContainText('Naît');
});

test('names a relationship from a record, in both languages', async ({ page }) => {
  const main = page.locator('main');
  for (const [prefix, labels] of [
    [
      '',
      { search: 'Le lien entre Gustave CHASSAGNE et…', find: 'Trouver le lien', answer: 'Père' },
    ],
    [
      '/en',
      {
        search: 'The relationship between Gustave CHASSAGNE and…',
        find: 'Find the relationship',
        answer: 'Father',
      },
    ],
  ] as const) {
    await page.goto(`${prefix}/app/${DEMO}/personnes?q=Gustave`);
    await main.getByRole('link', { name: 'Gustave CHASSAGNE' }).first().click();
    await page.waitForURL(/\/personnes\/[0-9a-f]{8}-/);
    await main.getByLabel(labels.search).fill('Jean-Baptiste');
    await page.getByRole('option', { name: /Jean-Baptiste CHASSAGNE/ }).click();
    await main.getByRole('button', { name: labels.find }).click();
    await expect(main.getByRole('status').filter({ hasText: labels.answer })).toBeVisible();
  }
  await page.context().clearCookies();
});
