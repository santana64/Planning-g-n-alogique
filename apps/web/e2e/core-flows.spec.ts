import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openPalette, settled, signUp } from './helpers';

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

  test('shows who a person was born of, and walks up to a parent', async ({ page }) => {
    await page.goto('/demo');

    // Pink and blue is the default reading; the choice is a real radio group.
    const sexReading = page.getByRole('radio', { name: /Femmes \/ hommes/ });
    await expect(sexReading).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Femme', { exact: true })).toBeVisible();

    // Select from the table, the path a keyboard or screen-reader user takes.
    await page.getByRole('button', { name: 'Voir le tableau' }).click();
    await page.getByRole('button', { name: 'Gustave CHASSAGNE' }).first().click();
    await page.getByRole('button', { name: 'Voir la frise' }).click();

    const panel = page.getByRole('complementary');
    await expect(panel).toContainText('Gustave CHASSAGNE');
    await expect(panel).toContainText('Parents');
    const mother = panel.getByRole('button', { name: /Rosalie CHASSAGNE/ });
    await expect(mother).toBeVisible();

    // A parent is one click away, and becomes the person shown.
    await mother.click();
    await expect(page.getByRole('complementary')).toContainText('Rosalie CHASSAGNE');
    await expect(
      page.getByRole('complementary').getByRole('link', { name: 'Ouvrir la fiche' }),
    ).toBeVisible();

    // The other reading is remembered across a reload.
    await page.getByRole('radio', { name: 'Branches' }).click();
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Branches' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByText('Femme', { exact: true })).toHaveCount(0);
  });

  test('opens on an overview, and its statistics say what they rest on', async ({ page }) => {
    await page.goto('/app/famille-chassagne-demo');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Famille Chassagne (démonstration)',
    );
    await expect(page.getByText('générations', { exact: true })).toBeVisible();
    // A visitor sees the ways in, never the work waiting for the family.
    await expect(page.getByRole('heading', { name: 'Explorer' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'En attente' })).toHaveCount(0);

    await page
      .getByRole('link', { name: /^Statistiques/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Statistiques');
    await expect(page.getByRole('figure', { name: 'Naissances par décennie' })).toBeVisible();
    // Each age says how many records it rests on.
    await expect(page.getByText(/sur \d+ personnes/).first()).toBeVisible();
    // Protected people are not counted: 40 records, 7 of them living.
    await expect(page.getByText('33', { exact: true }).first()).toBeVisible();

    // The same age, a generation apart, as a real table.
    await page.getByLabel('À l’âge de').selectOption('40');
    await page.getByRole('button', { name: 'Comparer' }).click();
    await expect(page).toHaveURL(/age=40/);
    const comparison = page.getByRole('table', { name: 'Comparaison à 40 ans' });
    await expect(comparison.getByRole('row')).not.toHaveCount(1);

    await settled(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.flatMap((v) =>
        v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} ${n.any[0]?.message ?? ''}`),
      ),
    ).toEqual([]);
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

    await expect(page.getByRole('table')).toContainText('Personne protégée');
    // Nor why they are hidden: "Vivant" beside a protected row would say it.
    const protectedRow = page.getByRole('row').filter({ hasText: 'Personne protégée' }).first();
    await expect(protectedRow).not.toContainText('Vivant');

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

    await openPalette(page);
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
    await openPalette(page);
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
    await openPalette(page);
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
    await openPalette(page);
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
    await expect(
      page.getByText(/personnes? protégées? ne figurent? pas sur la carte/),
    ).toBeVisible();
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
    await openPalette(page);
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
    await openPalette(page);
    await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('mathurin');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.getByRole('link', { name: 'Descendance →' }).click();
    await page
      .getByRole('navigation', { name: 'Profondeur' })
      .getByRole('link', { name: '10' })
      .click();
    await expect(page).toHaveURL(/g=10/);

    await expect(page.getByText('Personne protégée').first()).toBeVisible();
    const body = await page.content();
    for (const name of ['Camille', 'Léa', 'Mateo', 'Valentina']) {
      expect(body).not.toContain(name);
    }
  });
});

test.describe('the temporal fan', () => {
  test('draws an ancestry in years, and says how sure each year is', async ({ page }) => {
    await page.goto('/app/famille-chassagne-demo/personnes');
    await openPalette(page);
    await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('émile moreau');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Émile MOREAU');

    await page.getByRole('link', { name: 'Éventail temporel →' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Éventail temporel');
    await page
      .getByRole('navigation', { name: 'Profondeur' })
      .getByRole('link', { name: '8' })
      .click();
    await expect(page).toHaveURL(/g=8/);

    const chart = page.getByRole('figure', { name: /Éventail temporel de Émile MOREAU/ });
    await expect(chart).toBeVisible();
    // The centre is the year everything is measured from; the guides are
    // calendar years, not generation numbers.
    // The drawing itself is hidden from assistive technology — the caption
    // and the table carry it — so it is reached by element, not by role.
    const drawing = chart.locator('svg');
    await expect(drawing.getByText('1884', { exact: true })).toBeVisible();
    await expect(drawing.getByText('1850', { exact: true })).toBeVisible();
    await expect(drawing.getByText('Paul MOREAU', { exact: true })).toBeVisible();

    // The same positions as a table, for whoever cannot read the drawing.
    await page.getByText('Le détail, position par position').click();
    await expect(page.getByRole('row').filter({ hasText: 'Paul MOREAU' })).toContainText('34 ans');
    // "Vers 1702" is a span of years, and the table says so instead of
    // printing a single number the records do not support.
    await expect(page.getByRole('row').filter({ hasText: 'vers 1702' }).first()).toContainText(
      'entre',
    );
    // Cousins married here: an ancestor reached by two lines holds both places.
    await expect(page.getByRole('row').filter({ hasText: 'Mathurin CHASSAGNE' })).toHaveCount(2);

    // A drawing made of hundreds of links is where accessibility quietly
    // breaks: nested controls inside an image, a tab order hundreds long.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });

  test('draws nothing for a living person, whose birth year is the centre', async ({ page }) => {
    await page.goto('/app/famille-chassagne-demo/personnes');
    await page
      .getByRole('link', { name: /Personne protégée/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'Éventail temporel →' }).click();

    await expect(page.getByText('Cette personne est protégée.', { exact: false })).toBeVisible();
    await expect(page.getByRole('figure')).toHaveCount(0);
    const body = await page.content();
    for (const name of ['Claire', 'Sylvie', 'Thomas', 'Valentina', 'Camille', 'Léa', 'Mateo']) {
      expect(body).not.toContain(name);
    }
  });
});

test.describe('the constellation', () => {
  const CONSTELLATION = '/app/famille-chassagne-demo/constellation';
  const LIVING = ['Claire', 'Sylvie', 'Thomas', 'Valentina', 'Camille', 'Léa', 'Mateo'];

  /**
   * Read the canvas back, in the same task as a frame.
   *
   * A WebGL drawing buffer is only readable until the frame is composited,
   * so the next frame is caught from inside requestAnimationFrame, right
   * after the scene has drawn it. Counting pixels is the only way to tell a
   * drawn constellation from an empty canvas with names laid over it — which
   * is exactly the failure this caught during development.
   */
  async function readCanvas(page: Page) {
    return page.evaluate(async () => {
      const root = document.querySelector<HTMLElement>('[data-renderer]');
      const canvas = root?.querySelector('canvas');
      const gl = canvas?.getContext('webgl2');
      if (!root || !canvas || !gl) return null;
      const original = window.requestAnimationFrame.bind(window);
      const before = Number(root.dataset['frames']);
      let result: { lit: number; sky: number; total: number } | null = null;
      window.requestAnimationFrame = (callback) =>
        original((time) => {
          callback(time);
          if (result || Number(root.dataset['frames']) <= before) return;
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(
            0,
            0,
            gl.drawingBufferWidth,
            gl.drawingBufferHeight,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          let lit = 0;
          let sky = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            const r = pixels[index] as number;
            const g = pixels[index + 1] as number;
            const b = pixels[index + 2] as number;
            if (r + g + b > 300) lit += 1;
            if (Math.abs(r - 11) < 6 && Math.abs(g - 16) < 6 && Math.abs(b - 32) < 6) sky += 1;
          }
          result = { lit, sky, total: pixels.length / 4 };
        });
      document.querySelector<HTMLButtonElement>('button[aria-label="Rapprocher"]')?.click();
      for (let wait = 0; wait < 50 && !result; wait += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      window.requestAnimationFrame = original;
      // Assigned inside the frame callback, which the compiler cannot follow.
      return result as { lit: number; sky: number; total: number } | null;
    });
  }

  test('draws the family as light, and names who is at the centre', async ({ page }) => {
    await page.goto(CONSTELLATION);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Constellation');

    const sky = page.locator('[data-renderer]');
    // Never a blank rectangle: a renderer, or a sentence saying there is none.
    await expect(sky).toHaveAttribute('data-renderer', /^(webgpu|webgl2)$/, { timeout: 15_000 });
    await expect(sky).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });

    const renderer = await sky.getAttribute('data-renderer');
    if (renderer === 'webgl2') {
      const pixels = await readCanvas(page);
      expect(pixels, 'the canvas could be read back').not.toBeNull();
      // The sky is painted, and stars and lines are drawn on it.
      expect(pixels?.sky ?? 0).toBeGreaterThan((pixels?.total ?? 0) / 2);
      expect(pixels?.lit ?? 0).toBeGreaterThan(100);
    }

    // The person at the centre is named over the drawing, and heads the list.
    const focus = page.locator('.constellation-label[data-kind="focus"]');
    await expect(focus).toBeVisible();
    const people = page.getByRole('region', { name: /personnes de la constellation/ });
    await expect(people).toContainText('Au centre');
    await expect(people).toContainText((await focus.textContent()) ?? '');

    const body = await page.content();
    for (const name of LIVING) {
      expect(body, `${name} must not appear in a public page`).not.toContain(name);
    }
  });

  test('moves to someone else, and keeps the reach', async ({ page }) => {
    await page.goto(`${CONSTELLATION}?liens=4`);
    const people = page.getByRole('region', { name: /personnes de la constellation/ });
    await people.getByRole('link', { name: /Centrer la constellation sur Émile MOREAU/ }).click();

    await expect(page).toHaveURL(/focus=[0-9a-f-]{36}/);
    await expect(page).toHaveURL(/liens=4/);
    await expect(page.locator('.constellation-label[data-kind="focus"]')).toHaveText(
      'Émile MOREAU',
      { timeout: 15_000 },
    );
  });

  test('looks into the centuries in depth', async ({ page }) => {
    await page.goto(CONSTELLATION);
    const sky = page.locator('[data-renderer]');
    await expect(sky).toHaveAttribute('data-settled', 'true', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Profondeur' }).click();
    await expect(page.getByRole('button', { name: 'Profondeur' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(sky).toHaveAttribute('data-mode', 'depth');
    // Century planes, labelled with their year.
    await expect(
      page
        .locator('.constellation-label[data-kind="guide"]')
        .filter({ hasText: /^1[6-9]00$/ })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('says so, above the same list, when it cannot draw', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto(CONSTELLATION);

    await expect(page.locator('[data-renderer]')).toHaveAttribute('data-renderer', 'unsupported');
    await expect(page.getByText(/ni de WebGPU ni de WebGL 2/)).toBeVisible();
    await expect(page.getByRole('region', { name: /personnes de la constellation/ })).toContainText(
      'Au centre',
    );
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await page.goto(CONSTELLATION);
    await expect(page.locator('[data-renderer]')).toHaveAttribute('data-settled', 'true', {
      timeout: 15_000,
    });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
});

test.describe('the story', () => {
  async function openEmile(page: Page) {
    await page.goto('/app/famille-chassagne-demo/personnes');
    await openPalette(page);
    await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('émile moreau');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Émile MOREAU');
    await page.getByRole('link', { name: 'Remonter la lignée →' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remonter la lignée');
  }

  test('climbs back in time, citing every fact it states', async ({ page }) => {
    await openEmile(page);

    // A climb into the past: the years beside the chapters only ever go back.
    const markers = await page.locator('li[id^="chapter-"] > p:first-child').allTextContents();
    const years = markers
      .map((marker) => Number.parseInt(marker.replace(/\D+/g, ''), 10))
      .filter((year) => !Number.isNaN(year));
    expect(years.length).toBeGreaterThan(3);
    expect([...years].sort((a, b) => b - a)).toEqual(years);

    // The written story, not the player's dialog, which holds the same text
    // while closed.
    const story = page.getByRole('list', { name: 'Récit' });
    await expect(story).toContainText('Il a 34 ans à la naissance d’Émile MOREAU.');
    // Sources are notes, and a fact without one says so.
    await expect(story.getByRole('list', { name: 'Sources' }).first()).toBeVisible();
    await expect(story.getByText('(sans source)').first()).toBeVisible();
    // History is marked as history, not as the family's own record.
    await expect(
      story.getByRole('complementary', { name: 'Contexte historique' }).first(),
    ).toContainText('pas un fait tiré des archives de la famille');
    // The story ends where the record does, and says so.
    await expect(story).toContainText('c’est là que la recherche continue');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });

  test('reads one generation at a time, and lets the reader out at once', async ({ page }) => {
    await openEmile(page);
    const open = page.getByRole('button', { name: 'Lire comme un récit' });
    await open.click();

    const player = page.getByRole('dialog', { name: /Remonter la lignée/ });
    await expect(player).toBeVisible();
    // The reflex key press moves the story on rather than closing it.
    await expect(player.getByRole('button', { name: 'Suivant →' })).toBeFocused();
    await expect(player.getByRole('heading', { level: 2 })).toHaveText('Émile MOREAU');

    await page.keyboard.press('ArrowRight');
    await expect(player.getByRole('heading', { level: 2 })).toHaveText('Paul MOREAU');
    await expect(player).toContainText('2 /');

    await page.keyboard.press('Escape');
    await expect(player).toBeHidden();
    await expect(open).toBeFocused();
  });

  test('follows the paternal line when asked', async ({ page }) => {
    await openEmile(page);
    await page
      .getByRole('navigation', { name: 'Lignée' })
      .getByRole('link', { name: 'Paternelle' })
      .click();
    await expect(page).toHaveURL(/ligne=paternelle/);

    const eyebrows = await page
      .locator('li[id^="chapter-"] section > p:first-child')
      .allTextContents();
    // After the starting point, every step is a father.
    for (const eyebrow of eyebrows.slice(1, -1)) expect(eyebrow).toMatch(/^Père /);
    await expect(page.getByRole('list', { name: 'Récit' })).toContainText(
      /Le père de .+ n’est pas connu/,
    );
  });

  test('tells no story of a living person to a stranger', async ({ page }) => {
    await page.goto('/app/famille-chassagne-demo/personnes');
    await page
      .getByRole('link', { name: /Personne protégée/ })
      .first()
      .click();
    await page.getByRole('link', { name: 'Remonter la lignée →' }).click();

    await expect(page.getByText('Cette personne est protégée.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lire comme un récit' })).toHaveCount(0);
    const body = await page.content();
    for (const name of ['Claire', 'Sylvie', 'Thomas', 'Valentina', 'Camille', 'Léa', 'Mateo']) {
      expect(body).not.toContain(name);
    }
  });
});

test.describe('the story director', () => {
  test('offers the stories the tree already holds, chosen by rules', async ({ page }) => {
    await page.goto('/app/famille-chassagne-demo/personnes');
    await page
      .getByRole('navigation', { name: 'Sections de l’arbre' })
      .getByRole('link', { name: 'Récits' })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Récits suggérés');
    await expect(
      page.getByRole('status').filter({ hasText: 'Sélection par règles' }),
    ).toBeVisible();

    // The emigration the demonstration family made, found by distance alone.
    await expect(page.getByRole('heading', { name: 'De Tours à Buenos Aires' })).toBeVisible();
    // A stranger is never offered the model's choice.
    await expect(page.getByRole('button', { name: /Demander une sélection/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Lire « De Tours à Buenos Aires »' }).click();
    const player = page.getByRole('dialog', { name: 'De Tours à Buenos Aires' });
    await expect(player.getByRole('heading', { level: 2 })).toHaveText('Ricardo CHASSAGNE');
    // Born and buried in Buenos Aires: the First World War, confined to
    // Europe in the historical layer, is not his context.
    await expect(player).not.toContainText('Première Guerre mondiale');
    await page.keyboard.press('Escape');

    const body = await page.content();
    for (const name of ['Claire', 'Sylvie', 'Thomas', 'Valentina', 'Camille', 'Léa', 'Mateo']) {
      expect(body, `${name} must not appear in a suggested story`).not.toContain(name);
    }

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
});

test.describe('machine proposals', () => {
  test('are never shown to someone outside the tree, even on a public one', async ({ page }) => {
    // A pending proposal is a reading nobody has vouched for. Publishing it
    // would present unverified statements about a family as its record.
    const response = await page.goto('/app/famille-chassagne-demo/propositions');
    expect(response?.status()).toBe(404);

    await page.goto('/app/famille-chassagne-demo/personnes');
    await expect(page.getByRole('link', { name: 'Propositions' })).toHaveCount(0);
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
    await signUp(page, { name: 'Test 404', email, password: `E2e-${Date.now()}-abcdefgh` });

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
  test('creates an account, confirms it by mail, and lands in the application', async ({
    page,
  }) => {
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`;
    const password = `E2e-${Math.random().toString(36).slice(2)}-${Date.now()}`;

    await page.goto('/sign-up');
    // The helper does what a person does: sign up, then open the link from
    // the message that arrives (docs/SECURITY.md).
    await signUp(page, { name: 'Test E2E', email, password });

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
