import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * The flows that must never break.
 *
 * Kept deliberately few and deliberately load-bearing. A suite that asserts
 * every heading becomes a suite nobody trusts when it goes red, and the point
 * of these is that going red means something is actually wrong.
 *
 * Each one checks a product promise rather than a rendering detail, so they
 * survive a redesign — the only kind of E2E test worth maintaining.
 */

test.describe('landing', () => {
  test('opens without an account and shows the idea', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Chronolignée');

    // The timeline figure carries a real description, not just pixels.
    await expect(page.getByRole('img', { name: /famille fictive/i })).toBeVisible();
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });

  test('offers a skip link to keyboard users', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /contenu principal/i })).toBeFocused();
  });
});

test.describe('the demonstration timeline', () => {
  test('renders without signing in', async ({ page }) => {
    await page.goto('/demo');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Chassagne');
    await expect(page.getByRole('application', { name: /chronologie/i })).toBeVisible();
  });

  test('publishes the same data as a real table', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Voir le tableau' }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // A Republican-calendar date is rendered in its own calendar, not
    // silently converted.
    await expect(table).toContainText('germinal an VII');

    // The register entry we could not parse is shown as the human read it,
    // through an accepted claim.
    await expect(table).toContainText('9 novembre 1889');
  });

  test('redacts living people from an anonymous visitor', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Voir le tableau' }).click();

    await expect(page.getByRole('table')).toContainText('Personne vivante');

    // Not a single living person's name reaches the page.
    const html = await page.content();
    for (const name of ['Claire', 'Sylvie', 'Valentina', 'Thomas', 'Camille', 'Léa', 'Mateo']) {
      expect(html, `${name} must not appear in a public page`).not.toContain(name);
    }
  });

  test('answers "who was alive" in three numbers, never one', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Voyager dans le temps' }).click();

    const status = page.getByRole('status').filter({ hasText: 'avec certitude' });
    await expect(status).toBeVisible();
    await expect(status).toContainText('avec certitude');
    await expect(status).toContainText('possiblement');
    await expect(status).toContainText('sans date');
  });

  test('moves the cursor to a chosen date and updates the counts', async ({ page }) => {
    await page.goto('/demo');
    await page.getByRole('button', { name: 'Voyager dans le temps' }).click();

    const before = await page.getByRole('status').filter({ hasText: 'avec certitude' }).innerText();

    // Jump to 1789 — a century earlier, so the answer must change.
    await page.getByRole('button', { name: '1789', exact: true }).click();
    await expect(async () => {
      const after = await page
        .getByRole('status')
        .filter({ hasText: 'avec certitude' })
        .innerText();
      expect(after).not.toBe(before);
    }).toPass();
  });
});

test.describe('authorisation', () => {
  test('sends an anonymous visitor to sign in rather than showing a tree', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/sign-in/);
  });

  test('does not reveal whether a tree exists to someone who cannot see it', async ({ page }) => {
    // An anonymous visitor is redirected to sign in before the question is
    // even asked, so the property has to be checked while signed in: a tree
    // this account is not a member of must answer 404, exactly as a tree that
    // does not exist does. A 403 would confirm the archive is real.
    const email = `e2e-404-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`;
    await page.goto('/sign-up');
    await page.getByLabel('Nom').fill('Test 404');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(`E2e-${Date.now()}-abcdefgh`);
    await page.getByRole('button', { name: 'Créer un compte' }).click();
    await expect(page).toHaveURL(/\/app/);

    const response = await page.goto('/app/famille-inexistante-xyz/chronologie');
    expect(response?.status()).toBe(404);
  });

  test('refuses an unauthenticated import', async ({ request }) => {
    const response = await request.post('/api/trees/famille-chassagne-demo/import', {
      multipart: {
        file: {
          name: 'x.ged',
          mimeType: 'text/plain',
          buffer: Buffer.from('0 HEAD\r\n0 TRLR\r\n'),
        },
      },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('sign up and sign in', () => {
  test('creates an account and lands in the application', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`;
    const password = `E2e-${Math.random().toString(36).slice(2)}-${Date.now()}`;

    await page.goto('/sign-up');
    await page.getByLabel('Nom').fill('Test E2E');
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button', { name: 'Créer un compte' }).click();

    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByText(email)).toBeVisible();
  });

  test('says the same thing whichever half of the credentials is wrong', async ({ page }) => {
    // Distinguishing them would turn the form into an account-enumeration
    // oracle: an attacker learns which addresses are registered.
    await page.goto('/sign-in');
    await page.getByLabel('Adresse e-mail').fill('nobody@chronolignee.invalid');
    await page.getByLabel('Mot de passe').fill('not-the-right-password');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page.locator('form').getByRole('alert')).toContainText(/incorrect/i);
  });

  test('refuses a password too short to protect decades of research', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Nom').fill('Test');
    await page.getByLabel('Adresse e-mail').fill('short@chronolignee.invalid');
    await page.getByLabel('Mot de passe').fill('short');
    await page.getByRole('button', { name: 'Créer un compte' }).click();

    await expect(page.locator('form').getByRole('alert')).toContainText(/12 caractères/);
  });
});
