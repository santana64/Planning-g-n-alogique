import { expect, test } from '@playwright/test';

/**
 * The mobile path.
 *
 * The timeline is a desktop research instrument and a phone gets a different
 * treatment, so this checks the difference is real rather than a shrunk copy —
 * the specific failure the brief warns about.
 */

test('the page itself never scrolls sideways', async ({ page }) => {
  await page.goto('/');

  // Wide content scrolls inside its own container. A body that scrolls
  // horizontally means something escaped its bounds.
  const overflow = await page.evaluate(() => {
    const body = document.body;
    return body.scrollWidth - body.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the timeline stays legible instead of being squeezed', async ({ page }) => {
  await page.goto('/');

  const figure = page.locator('figure').first();
  await expect(figure).toBeVisible();

  // The drawing keeps a readable minimum width and its container scrolls.
  // Squeezing thirteen names into 375 pixels communicates nothing.
  const { svgWidth, containerWidth } = await figure.evaluate((element) => {
    const svg = element.querySelector('svg');
    const container = svg?.parentElement;
    return {
      svgWidth: svg?.getBoundingClientRect().width ?? 0,
      containerWidth: container?.clientWidth ?? 0,
    };
  });

  expect(svgWidth).toBeGreaterThan(containerWidth);
  expect(svgWidth).toBeGreaterThanOrEqual(820);
});

test('the call to action is reachable without scrolling past the fold', async ({ page }) => {
  await page.goto('/');
  const cta = page.getByRole('link', { name: /explorer mon histoire/i });
  await expect(cta).toBeInViewport();
});

test('the demonstration timeline offers its table on a phone', async ({ page }) => {
  await page.goto('/demo');
  // A canvas the size of a phone screen is not a research tool; the table is
  // the usable representation there and must be reachable.
  await page.getByRole('button', { name: 'Voir le tableau' }).click();
  await expect(page.getByRole('table')).toBeVisible();
});
