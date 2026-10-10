import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { EDITING_STATE_PATH } from './global-setup';
import { addPerson, createTree, fillStable } from './helpers';

/**
 * The research desk, end to end.
 *
 * A record with an impossible date and no source, then the page that says
 * so, then a question opened about it and answered — including the answer
 * "nothing found", which the page must keep.
 */

test.describe.configure({ timeout: 90_000 });
test.use({ storageState: EDITING_STATE_PATH });

test('a contradiction and a missing source become a question, and its answer is kept', async ({
  page,
}) => {
  await page.goto('/app');
  await createTree(page, `Recherche E2E ${Date.now()}`);
  // Dates that contradict each other can be saved: the record says what the
  // register says, and the research page is where the contradiction surfaces.
  await addPerson(page, { given: 'Hippolyte', surname: 'Marchand', birth: '1880', death: '1850' });

  await page.getByRole('link', { name: 'Recherche' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recherche');

  const anomalies = page.locator('#anomalies');
  await expect(anomalies).toContainText('Hippolyte MARCHAND : le décès précède la naissance.');
  await expect(page.locator('#sans-source')).toContainText('Naissance');

  // Filtering by severity keeps the impossible and hides nothing else.
  await anomalies.getByRole('button', { name: /^Impossible/ }).click();
  await expect(anomalies.getByRole('button', { name: /^Impossible/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(anomalies).toContainText('le décès précède la naissance');

  // Open a question about him.
  await page.getByText('Ouvrir une piste').click();
  await fillStable(page, 'Question', 'Acte de décès d’Hippolyte');
  await page.getByLabel('À propos de').selectOption({ label: 'Hippolyte MARCHAND' });
  await fillStable(page, 'De', '1845');
  await fillStable(page, 'À', '1885');
  await page.getByRole('button', { name: 'Ouvrir la piste' }).click();
  await expect(page.getByText('Piste ouverte.')).toBeVisible();

  const tasks = page.locator('#pistes');
  await expect(tasks.getByRole('heading', { name: 'Acte de décès d’Hippolyte' })).toBeVisible();
  await expect(tasks).toContainText('1845 – 1885');

  // A period that ends before it starts is refused with a reason.
  await fillStable(page, 'Question', 'À rebours');
  await fillStable(page, 'De', '1900');
  await fillStable(page, 'À', '1800');
  await page.getByRole('button', { name: 'Ouvrir la piste' }).click();
  await expect(page.getByText('La fin de la période précède son début.')).toBeVisible();

  // "Nothing found" is a result, and it is kept with the closed task.
  await tasks.getByRole('button', { name: 'Mettre à jour' }).first().click();
  await tasks.getByLabel('État').selectOption('RESOLVED');
  await tasks.getByLabel('Résultat').fill('Rien dans les tables décennales 1843-1852.');
  await tasks.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(tasks.getByText('1 piste close')).toBeVisible();
  await tasks.getByText('1 piste close').click();
  await expect(tasks).toContainText('Rien dans les tables décennales 1843-1852.');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.failureSummary ?? '')).join(' | ')}`,
    ),
  ).toEqual([]);
});

test('is not shown to someone outside the tree', async ({ browser }) => {
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  // The public demonstration is readable; its research desk is not.
  const response = await page.goto('/app/famille-chassagne-demo/recherche');
  expect(response?.status()).toBe(404);
  await page.goto('/app/famille-chassagne-demo/personnes');
  await expect(page.getByRole('link', { name: 'Recherche' })).toHaveCount(0);
  await anonymous.close();
});
