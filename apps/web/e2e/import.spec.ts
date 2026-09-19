import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { EDITING_STATE_PATH } from './global-setup';
import { createTree } from './helpers';

/**
 * A GEDCOM import, the way a French researcher's file actually arrives: a
 * 5.5.1 export declaring "CHAR ANSI", written in Windows-1252, with accented
 * names and a Republican date. Read as UTF-8 it imported "LEF�VRE" into the
 * tree without a word; the review must now say how it read the file, show the
 * names as they will be written, and write nothing until asked.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ storageState: EDITING_STATE_PATH });

const LEGACY_FILE = [
  '0 HEAD',
  '1 SOUR HEREDIS',
  '1 GEDC',
  '2 VERS 5.5.1',
  '2 FORM LINEAGE-LINKED',
  '1 CHAR ANSI',
  '0 @I1@ INDI',
  '1 NAME Honoré /LEFÈVRE/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE @#DFRENCH R@ 4 GERM 7',
  '2 PLAC Tours',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Françoise /MÉNARD/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE ABT 1802',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Anaïs /LEFÈVRE/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE 12 JUN 1822',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 CHIL @I3@',
  '1 MARR',
  '2 DATE 1821',
  '0 TRLR',
  '',
].join('\r\n');

test('imports a legacy file without losing a single accent', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/app');
  await createTree(page, `Import ${stamp}`);
  const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';

  await page.goto(`/app/${slug}/import`);
  await page.getByLabel('Fichier GEDCOM').setInputFiles({
    name: 'lefevre.ged',
    mimeType: 'text/plain',
    // Latin-1 bytes are Windows-1252 bytes for every letter used here.
    buffer: Buffer.from(LEGACY_FILE, 'latin1'),
  });

  // The review: measured from the file, nothing written yet.
  const review = page.locator('main');
  await expect(review).toContainText('encodage Windows-1252 (déclaré « ANSI »)');
  await expect(review).toContainText('Honoré LEFÈVRE');
  await expect(review).toContainText('Françoise MÉNARD');
  await expect(review).not.toContainText('\ufffd');
  await expect(review.getByText('personnes', { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole('button', { name: 'Importer 3 personnes' }).click();
  await expect(page.getByText('3 personnes ajoutées.')).toBeVisible();

  // Written as read: the accents, and the Republican date in its calendar.
  await page.goto(`/app/${slug}/personnes`);
  await expect(page.locator('main')).toContainText('Anaïs LEFÈVRE');
  await page.getByRole('link', { name: /Honoré LEFÈVRE/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Honoré LEFÈVRE');
  await expect(page.locator('main')).toContainText('4 germinal an VII');

  // And the import is in the history, signed and counted.
  await page.goto(`/app/${slug}/historique`);
  await expect(page.locator('main')).toContainText('a importé un fichier GEDCOM : 3 personnes');
});

test('says which file it cannot read rather than garbling it', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/app');
  await createTree(page, `Import DOS ${stamp}`);
  const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';

  await page.goto(`/app/${slug}/import`);
  await page.getByLabel('Fichier GEDCOM').setInputFiles({
    name: 'dos.ged',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      LEGACY_FILE.replace('1 CHAR ANSI', '1 CHAR IBMPC').replace('Honoré', 'Honor\u0082'),
      'latin1',
    ),
  });
  await expect(page.locator('main').getByRole('alert')).toContainText('encodage DOS (IBMPC)');

  await page.goto(`/app/${slug}/personnes`);
  await expect(page.getByText('Cet arbre est vide.')).toBeVisible();
});
