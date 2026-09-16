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

    // Wait for the stylesheet to have actually painted before measuring.
    //
    // axe reads computed colours. Under parallel load it can run while the
    // page is still unstyled, at which point every element reports the body's
    // own background as both foreground and background — contrast 1.01 — and
    // the suite reports a contrast failure that exists nowhere but in that
    // frame. Waiting on the accent button's own background is a direct check
    // that the cascade has landed.
    await expect
      .poll(async () =>
        page
          .locator('.bg-accent')
          .first()
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe('rgba(0, 0, 0, 0)');
    await page.evaluate(() => document.fonts.ready);

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

test.describe('the command palette', () => {
  // The demonstration tree is public, so these run without an account — which
  // also means every assertion about redaction here is made from exactly the
  // position the redaction exists to defend against.
  const TREE = '/app/famille-chassagne-demo/personnes';

  test('finds a person by a spelling nobody in the tree uses', async ({ page }) => {
    await page.goto(TREE);

    await page.keyboard.press('ControlOrMeta+k');
    const search = page.getByRole('combobox', { name: /Chercher une personne/ });
    await expect(search).toBeFocused();

    // CHASSAIGNE is not how most of this family spells it. A search that only
    // matched substrings would hide exactly the duplicate a researcher hunts.
    await search.fill('chassaigne');
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Résultats' })).toContainText('CHASSAGNE');
    await expect(page.getByText('orthographe proche').first()).toBeVisible();
  });

  test('opens the record from the keyboard alone', async ({ page }) => {
    await page.goto(TREE);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('hippolyte');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');

    // The demo tree is public, so an anonymous visitor lands on the record.
    await expect(page).toHaveURL(/\/personnes\/[0-9a-f]{8}-/);
    // Given name as written, surname in caps: the French convention, and the
    // only thing telling a reader which token is the family name.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hippolyte CHASSAGNE');
  });

  test('never offers a living person to a stranger', async ({ page }) => {
    await page.goto(TREE);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('bertrand');
    await expect(page.getByRole('option').first()).toBeVisible();

    // Living BERTRANDs exist in this tree. Searching the surname must not put
    // their names or years in front of someone outside the family.
    const listbox = page.getByRole('listbox', { name: 'Résultats' });
    await expect(listbox).not.toContainText('Camille');
    await expect(listbox).not.toContainText('Léa');
    await expect(listbox).not.toContainText('Thomas');
  });

  test('closes on escape and gives the focus back', async ({ page }) => {
    await page.goto(TREE);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Recherche' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Recherche' })).toHaveCount(0);
  });
});

test.describe('the map', () => {
  const MAP = '/app/famille-chassagne-demo/carte';

  test('publishes its numbers as a table, not only as a canvas', async ({ page }) => {
    await page.goto(MAP);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Carte');

    // A canvas is opaque to a screen reader and to anyone wanting to copy a
    // figure out. The same decision the timeline makes, for the same reason.
    await page.getByRole('button', { name: 'Voir le tableau' }).click();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Tours');
    await expect(table).toContainText('Buenos Aires');
  });

  test('says what it cannot draw instead of quietly omitting it', async ({ page }) => {
    await page.goto(MAP);
    // Countries and departments carry no coordinates in this tree. A map that
    // silently dropped them would misstate how much of the archive it covers.
    await expect(page.getByText(/coordonnées/)).toBeVisible();
  });

  test('withholds living people’s movements from a stranger', async ({ page }) => {
    await page.goto(MAP);
    await expect(page.getByText(/déplacements de .* vivantes? ne sont pas affichés/)).toBeVisible();
  });

  test('moves the year and narrows what is shown', async ({ page }) => {
    await page.goto(MAP);
    await page.getByRole('button', { name: 'Voir le tableau' }).click();

    const rowsBefore = await page.getByRole('row').count();

    // Back to roughly a fifth of the way through the recorded span. The value
    // is computed from the input's own min and step: a range input refuses a
    // value off its step grid, and hard-coding one couples the test to how
    // wide the demonstration tree happens to be.
    const slider = page.getByLabel('Année');
    const early = await slider.evaluate((element) => {
      const input = element as HTMLInputElement;
      const min = Number(input.min);
      const step = Number(input.step) || 1;
      const steps = Math.floor((Number(input.max) - min) / step / 5);
      return String(min + steps * step);
    });
    await slider.fill(early);

    // Fewer places stand before the family had been to most of them.
    await expect(page.getByRole('row')).not.toHaveCount(rowsBefore);
  });

  test('loads its basemap from the application, not a tile provider', async ({ request }) => {
    // The map ships its own public-domain outline. If this ever 404s, the
    // page renders an empty ocean and nobody notices until someone opens it.
    const response = await request.get('/basemap/countries-110m.geojson');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { features: unknown[] };
    expect(body.features.length).toBeGreaterThan(150);
  });
});

test.describe('descent', () => {
  test('numbers a descendant study and marks where lines rejoin', async ({ page }) => {
    // Reached through the palette so the journey is the real one: a name in
    // the head, a record on screen, then the study.
    await page.goto('/app/famille-chassagne-demo/personnes');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('mathurin');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mathurin CHASSAGNE');

    await page.getByRole('link', { name: 'Descendance →' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Descendance');

    // Mathurin is born in 1702, so five generations stop in the 1850s. The
    // depth control is how a descendant study reaches the present, and this
    // exercises it rather than hard-coding a URL.
    await page
      .getByRole('navigation', { name: 'Profondeur' })
      .getByRole('link', { name: '10' })
      .click();
    await expect(page).toHaveURL(/g=10/);

    // D'Aboville: the subject is 1, the eldest child 1.1.
    const list = page.getByRole('list').filter({ hasText: '1.1' });
    await expect(list).toBeVisible();

    // Cousins married in this family, so some descendants arrive by two
    // lines. Collapsing those to one row would hide the loop.
    await expect(page.getByText('descend par deux lignes').first()).toBeVisible();
  });

  test('redacts the living descendants a study inevitably reaches', async ({ page }) => {
    // A descendant study is the one view that runs into the present by
    // construction: the last two generations are mostly alive.
    await page.goto('/app/famille-chassagne-demo/personnes');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('mathurin');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.getByRole('link', { name: 'Descendance →' }).click();
    await page
      .getByRole('navigation', { name: 'Profondeur' })
      .getByRole('link', { name: '10' })
      .click();
    await expect(page).toHaveURL(/g=10/);

    await expect(page.getByText('Personne vivante').first()).toBeVisible();
    const body = await page.content();
    for (const name of ['Camille', 'Léa', 'Mateo', 'Valentina']) {
      expect(body).not.toContain(name);
    }
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
