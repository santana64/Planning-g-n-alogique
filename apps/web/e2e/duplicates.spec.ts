import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { EDITING_STATE_PATH } from './global-setup';
import { addPerson, createTree } from './helpers';

/**
 * The same person, written down twice.
 *
 * What a researcher meets on their second import: two spellings of one name,
 * one precise date and one vague, two women who merely share a first name and
 * a year, and a son carrying his father's name a generation later. The scan
 * proposes, the comparison informs, and only the reader merges.
 */

test.describe.configure({ timeout: 180_000 });
test.use({ storageState: EDITING_STATE_PATH });

test('rapproche deux fiches d’une même personne, puis n’en garde qu’une', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/app');
  await createTree(page, `Doublons ${stamp}`);
  const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';

  await addPerson(page, {
    given: 'Augustin',
    surname: 'Rouvière',
    birth: '12 juin 1834',
    death: '3 février 1901',
  });
  await addPerson(page, { given: 'Augustin', surname: 'Rouvier', birth: '1834' });
  const retiredUrl = page.url();
  // The son, named after his father: same name, one generation later.
  await addPerson(page, { given: 'Augustin', surname: 'Rouvière', birth: '1868' });
  await addPerson(page, { given: 'Célestine', surname: 'Barraud', birth: '1840', sex: 'FEMALE' });
  await addPerson(page, { given: 'Célestine', surname: 'Barrault', birth: '1840', sex: 'FEMALE' });

  await page.goto(`/app/${slug}/doublons`);
  await expect(page.getByText('Aucun rapprochement en attente')).toBeVisible();

  // The scan runs in the worker; the page asks again until it has finished.
  await page.getByRole('button', { name: 'Chercher des doublons' }).click();
  await expect(page.getByRole('link', { name: 'Comparer' })).toHaveCount(2, { timeout: 60_000 });

  const rows = page.locator('main li');
  const twins = rows.filter({ hasText: 'ROUVIÈRE' });
  await expect(twins).toHaveCount(1);
  await expect(twins).toContainText('Augustin ROUVIER (');
  // The score comes with the signals that produced it, never alone.
  await expect(twins).toContainText('concordent : nom, prénom, naissance');
  // Father and son were never proposed: thirty-four years rule it out.
  await expect(rows.filter({ hasText: '1868' })).toHaveCount(0);

  // Two people who merely share a first name and a year: said once, gone.
  await rows
    .filter({ hasText: 'BARRAUD (' })
    .getByRole('button', { name: 'Deux personnes différentes' })
    .click();
  await expect(page.getByRole('link', { name: 'Comparer' })).toHaveCount(1);

  await page.getByRole('link', { name: 'Comparer' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Une même personne ?');
  const comparison = page.locator('main');
  await expect(comparison).toContainText('12 juin 1834');
  await expect(comparison).toContainText('3 février 1901');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // Keeping the fuller record; the other is retired, not deleted. The merge
  // is confirmed in a second step that names the record about to leave.
  await page.getByRole('button', { name: /Garder « Augustin ROUVIÈRE »/ }).click();
  await expect(page.locator('form').filter({ hasText: 'sera retirée de l’arbre' })).toContainText(
    'La fiche d’Augustin ROUVIER',
  );
  await page.getByRole('button', { name: 'Fusionner les deux fiches' }).click();
  await page.waitForURL(/\/personnes\/[0-9a-f]{8}-/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Augustin ROUVIÈRE');

  // Both births are kept: the merge does not choose between two dates.
  const events = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Événements' }) });
  await expect(events.locator('li').filter({ hasText: 'Naissance' })).toHaveCount(2);
  await expect(events).toContainText('12 juin 1834');

  // The retired record is out of the tree, and the pair is answered.
  expect((await page.goto(retiredUrl))?.status()).toBe(404);
  await page.goto(`/app/${slug}/doublons`);
  await expect(page.getByText('Aucun rapprochement en attente')).toBeVisible();

  // And the history says what became of the record that left.
  await page.goto(`/app/${slug}/historique`);
  await expect(page.locator('main')).toContainText(
    'a fusionné Augustin ROUVIER dans Augustin ROUVIÈRE — 1 événement repris',
  );
});

test('garde la revue des doublons à ceux qui peuvent écrire', async ({ browser }) => {
  const visitor = await (await browser.newContext({ storageState: undefined })).newPage();
  // A public tree stays readable; its duplicate review is not part of that,
  // and the answer is the one a page that does not exist gives.
  await visitor.goto('/app/famille-chassagne-demo/personnes');
  await expect(visitor.getByRole('link', { name: 'Doublons' })).toHaveCount(0);
  expect((await visitor.goto('/app/famille-chassagne-demo/doublons'))?.status()).toBe(404);
  await visitor.close();
});
