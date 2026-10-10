import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { EDITING_STATE_PATH } from './global-setup';
import { addPerson, createTree, fillStable, settled } from './helpers';

/**
 * The screens that run a tree — sharing, history, settings, one's account,
 * an invitation — checked the way the rest are: no detectable WCAG 2.1 AA
 * violation, and nothing that makes a phone's page scroll sideways.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ storageState: EDITING_STATE_PATH });

async function accessible(page: Page, label: string): Promise<void> {
  // Measured once the page has arrived, not halfway through its fade-in.
  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((violation) => `${label}: ${violation.id} (${violation.nodes.length})`),
  ).toEqual([]);
}

async function fitsAPhone(page: Page, label: string): Promise<void> {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} scrolls sideways on a phone`).toBeLessThanOrEqual(1);
  if (size) await page.setViewportSize(size);
}

test('the screens that run a tree are accessible and fit a phone', async ({ page, browser }) => {
  const stamp = Date.now();
  await page.goto('/app');
  await createTree(page, `Accessibilité ${stamp}`);
  const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';
  await addPerson(page, { given: 'Honorine', surname: 'Lambert', birth: '1861', death: '1932' });
  // The record page now carries its own history.
  await fillStable(page, 'Date de naissance', '1862');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('a été enregistré')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Historique de la fiche' })).toBeVisible();
  await accessible(page, 'fiche');
  await fitsAPhone(page, 'fiche');

  await page.goto(`/app/${slug}/partage`);
  await fillStable(page, 'Adresse e-mail', `e2e-a11y-${stamp}@chronolignee.invalid`);
  await page.getByRole('button', { name: 'Créer le lien' }).click();
  const link = await page.getByLabel('Lien d’invitation').inputValue();
  await accessible(page, 'partage');
  await fitsAPhone(page, 'partage');

  for (const [path, label] of [
    [`/app/${slug}/historique`, 'historique'],
    [`/app/${slug}/reglages`, 'réglages'],
    ['/compte', 'compte'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await accessible(page, label);
    await fitsAPhone(page, label);
  }

  // The invitation, as the person receiving it sees it: not signed in.
  const guest = await (await browser.newContext({ storageState: undefined })).newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByRole('heading', { level: 1 })).toBeVisible();
  await accessible(guest, 'invitation');
  await fitsAPhone(guest, 'invitation');
  await guest.context().close();
});

test('no screen of a tree scrolls sideways on a phone', async ({ browser }) => {
  // Wide drawings scroll inside their own frame; the page itself never does.
  const visitor = await (await browser.newContext({ storageState: undefined })).newPage();
  await visitor.setViewportSize({ width: 375, height: 812 });
  const tree = '/app/famille-chassagne-demo';
  await visitor.goto(`${tree}/personnes`);
  const person = await visitor.locator('main a[href*="/personnes/0"]').first().getAttribute('href');
  const paths = [
    `${tree}/personnes`,
    `${tree}/chronologie`,
    `${tree}/constellation`,
    `${tree}/carte`,
    `${tree}/archives`,
    `${tree}/recits`,
    person ?? '',
    `${person}/ascendance`,
    `${person}/descendance`,
    `${person}/eventail`,
    `${person}/recit`,
  ];
  for (const path of paths) {
    await visitor.goto(path);
    const overflow = await visitor.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways on a phone`).toBeLessThanOrEqual(1);
  }
  await visitor.context().close();
});
