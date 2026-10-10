import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { pngImage, twoPagePdf } from './fixtures';
import { EDITING_STATE_PATH } from './global-setup';
import { addPerson, createTree, settled } from './helpers';

/**
 * Photographs and documents, end to end.
 *
 * The journey: upload a photograph, name the person in it by drawing a
 * rectangle, see it on their record; then the privacy rule photographs add —
 * a picture of a protected relative is withheld, file and all. And a
 * document: read on the stage, zoomed, paged, transcribed beside the scan.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ storageState: EDITING_STATE_PATH });

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Sections de l’arbre' }).getByRole('link', { name });

async function drawRectangle(page: Page) {
  const stage = page.getByRole('application', { name: /Visionneuse/ });
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage');
  const x = box.x + box.width * 0.4;
  const y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 50, { steps: 6 });
  await page.mouse.up();
}

test('a photograph is uploaded, a person is named in it, and it reaches their record', async ({
  page,
  browser,
}) => {
  await page.goto('/app');
  await createTree(page, `Album ${Date.now()}`);
  const slug = new URL(page.url()).pathname.split('/')[2] ?? '';
  await addPerson(page, { given: 'Jeanne', surname: 'Vasseur', birth: '1890', death: '1960' });
  const jeanne = new URL(page.url()).pathname.split('/').pop() ?? '';
  await page.getByRole('link', { name: 'Toutes les personnes' }).click();
  await addPerson(page, { given: 'Lucas', surname: 'Vasseur', birth: '2001', living: true });

  // --- Upload -------------------------------------------------------------
  await nav(page, 'Photos').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Photographies');
  await page.getByLabel('Choisir des fichiers').setInputFiles([
    { name: 'noce-1912.png', mimeType: 'image/png', buffer: pngImage(800, 600) },
    { name: 'groupe-2015.png', mimeType: 'image/png', buffer: pngImage(640, 480) },
  ]);
  await expect(page.getByText('ajoutée')).toHaveCount(2, { timeout: 20_000 });
  const cards = page.getByRole('link', { name: /noce-1912\.png|groupe-2015\.png/ });
  await expect(cards).toHaveCount(2);

  // The worker makes a light, metadata-free version; the page then uses it.
  const photoHref = await page.getByRole('link', { name: /noce-1912\.png/ }).getAttribute('href');
  const mediaId = photoHref?.split('/').pop() ?? '';
  await expect
    .poll(
      async () =>
        (await page.request.get(`/api/trees/${slug}/media/${mediaId}?variant=thumbnail`)).headers()[
          'content-type'
        ],
      { timeout: 30_000 },
    )
    .toBe('image/webp');
  const served = await page.request.get(`/api/trees/${slug}/media/${mediaId}?variant=preview`);
  expect(served.headers()['content-security-policy']).toContain('sandbox');
  expect(served.headers()['x-content-type-options']).toBe('nosniff');

  // --- Name someone, by hand ----------------------------------------------
  await page.getByRole('link', { name: /noce-1912\.png/ }).click();
  await page.getByRole('button', { name: 'Identifier quelqu’un' }).click();
  await drawRectangle(page);
  await expect(page.getByRole('heading', { name: 'Qui est-ce ?' })).toBeVisible();
  await page.getByLabel('Chercher une personne').fill('jean');
  await page.getByRole('button', { name: 'Jeanne VASSEUR' }).click();
  await expect(page.getByText('1 personne identifiée')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Jeanne VASSEUR' })).toBeVisible();

  // --- The moment it shows: one of her events ------------------------------
  const shown = page.getByRole('region', { name: 'Événements illustrés' });
  await expect(shown.getByText('Cette photographie n’est liée à aucun événement.')).toBeVisible();
  await shown.getByLabel('Événement montré par la photographie').selectOption({
    label: 'Naissance · Jeanne VASSEUR · 1890',
  });
  await shown.getByRole('button', { name: 'Lier' }).click();
  await expect(shown.getByText('Naissance · Jeanne VASSEUR · 1890')).toBeVisible();
  await expect(
    shown.getByRole('button', { name: 'Retirer le lien avec Naissance · Jeanne VASSEUR · 1890' }),
  ).toBeVisible();

  // The stage zooms from its toolbar, and says by how much.
  await page.getByRole('button', { name: 'Agrandir' }).click();
  await settled(page);
  await expect(page.getByText(/\d+ %/)).toBeVisible();

  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);

  // --- On her record --------------------------------------------------------
  await page.goto(`/app/${slug}/personnes/${jeanne}`);
  await expect(page.getByRole('heading', { name: '1 photographie' })).toBeVisible();
  // And beside the event it shows.
  await expect(page.getByRole('img', { name: 'Photographie : noce-1912.png' })).toBeVisible();

  // --- A protected relative in a picture withholds the picture -------------
  await page.goto(`/app/${slug}/photos`);
  await page.getByRole('link', { name: /groupe-2015\.png/ }).click();
  const groupId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await page.getByRole('button', { name: 'Identifier quelqu’un' }).click();
  await drawRectangle(page);
  await page.getByRole('button', { name: 'Lucas VASSEUR' }).click();
  await expect(page.getByText('1 personne identifiée')).toBeVisible();

  await page.getByRole('link', { name: 'Réglages', exact: true }).click();
  await page.getByLabel('Par lien').check();
  await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await expect(page.getByText('Réglages enregistrés.')).toBeVisible();

  // Explicitly no session: a bare context inherits the signed-in one.
  const context = await browser.newContext({ storageState: undefined });
  const visitor = await context.newPage();
  await visitor.goto(`/app/${slug}/photos`);
  // The wedding is shown; the photograph of a living relative is not there at all.
  await expect(visitor.getByRole('link', { name: /noce-1912\.png/ })).toBeVisible();
  await expect(visitor.getByRole('link', { name: /groupe-2015\.png/ })).toHaveCount(0);
  for (const variant of ['thumbnail', 'preview', 'original']) {
    const response = await visitor.request.get(
      `/api/trees/${slug}/media/${groupId}?variant=${variant}`,
    );
    expect(response.status(), variant).toBe(404);
  }
  // Nor is the original of the visible one, which may carry where it was taken.
  expect(
    (await visitor.request.get(`/api/trees/${slug}/media/${mediaId}?variant=original`)).status(),
  ).toBe(404);
  await context.close();
});

test('a document is read on a stage, paged, zoomed and transcribed beside the scan', async ({
  page,
}) => {
  await page.goto('/app');
  await createTree(page, `Actes ${Date.now()}`);
  const slug = new URL(page.url()).pathname.split('/')[2] ?? '';

  const upload = await page.request.post(`/api/trees/${slug}/documents`, {
    multipart: {
      file: { name: 'registre.pdf', mimeType: 'application/pdf', buffer: twoPagePdf() },
      title: 'Registre paroissial, 1822',
    },
  });
  expect(upload.status()).toBe(200);

  await nav(page, 'Archives').click();
  await page.getByRole('link', { name: 'Registre paroissial, 1822' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Registre paroissial, 1822');

  // Drawn by pdf.js in the page, one page at a time.
  await expect(page.getByText('page 1 sur 2')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Page suivante' }).click();
  await expect(page.getByText('page 2 sur 2')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();

  const stage = page.getByRole('application', { name: /Visionneuse/ });
  const before = await page.getByText(/^\d+ %$/).textContent();
  await stage.focus();
  await page.keyboard.press('+');
  await expect(page.getByText(/^\d+ %$/)).not.toHaveText(before ?? '');

  // Transcribed beside the scan, verbatim.
  await page.getByLabel('Transcription').fill('Le six juin mil huit cent vingt-deux, led. Jean…');
  await page.getByRole('button', { name: 'Enregistrer la transcription' }).click();
  await expect(page.getByText('Transcription enregistrée.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Transcription')).toHaveValue(
    'Le six juin mil huit cent vingt-deux, led. Jean…',
  );

  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
});
