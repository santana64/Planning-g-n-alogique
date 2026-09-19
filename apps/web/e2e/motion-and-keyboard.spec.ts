import { expect, test, type Locator, type Page } from '@playwright/test';
import { EDITING_STATE_PATH } from './global-setup';
import { createTree } from './helpers';

/**
 * Two promises made to the readers who depend on them most: someone who asked
 * their system for less motion gets none that is decorative, and everything
 * can be done without a mouse, with the focus visible at every step.
 *
 * Each motion check runs twice, once without the preference: an assertion
 * that "nothing moves" passes just as well on a page where nothing ever
 * moved, and would keep passing the day the selector stopped matching.
 */

test.describe.configure({ timeout: 120_000 });

async function animationNames(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));
}

/**
 * Press Tab until `target` has focus, checking that every stop on the way
 * shows where the focus is.
 */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  const unseen: string[] = [];
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return null;
      const style = getComputedStyle(element);
      const name = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
      return {
        name: `${element.tagName.toLowerCase()} « ${(name || element.id).slice(0, 40)} »`,
        visible: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0,
      };
    });
    if (stop && !stop.visible) unseen.push(stop.name);
    if (await target.evaluate((element) => element === document.activeElement)) {
      expect(unseen, 'every focus stop must show the focus').toEqual([]);
      return;
    }
  }
  throw new Error(`${limit} presses of Tab never reached the target`);
}

test.describe('less motion', () => {
  test('the opening page arrives still', async ({ page }) => {
    await page.goto('/');
    const animated = '.rise, .life-reveal, .life-connector';
    expect(await animationNames(page, animated)).toContain('fade-rise');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const names = await animationNames(page, animated);
    expect(names.length).toBeGreaterThan(5);
    expect(new Set(names)).toEqual(new Set(['none']));
    // Nothing left waiting, invisible, for an animation that will not run.
    const opacities = await page
      .locator('.rise')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).opacity));
    expect(new Set(opacities)).toEqual(new Set(['1']));
  });

  test('the story changes year without running the clock', async ({ page }) => {
    async function openTheStory(): Promise<{ player: Locator; markers: string[] }> {
      await page.goto('/app/famille-chassagne-demo/personnes');
      await page.keyboard.press('ControlOrMeta+k');
      await page.getByRole('combobox', { name: /Chercher une personne/ }).fill('émile moreau');
      await expect(page.getByRole('option').first()).toBeVisible();
      await page.keyboard.press('Enter');
      await page.getByRole('link', { name: 'Remonter la lignée →' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Remonter la lignée');
      const markers = await page.locator('li[id^="chapter-"] > p:first-child').allTextContents();
      await page.getByRole('button', { name: 'Lire comme un récit' }).click();
      const player = page.getByRole('dialog', { name: /Remonter la lignée/ });
      await expect(player.getByRole('heading', { level: 2 })).toHaveText('Émile MOREAU');
      return { player, markers: markers.map((marker) => marker.trim()) };
    }

    /** Every year the player showed on its way to the next chapter. */
    async function yearsOnTheWay(player: Locator, arrival: string): Promise<string[]> {
      await page.evaluate(() => {
        const dialog = document.querySelector('dialog[open]');
        if (!dialog) throw new Error('the story player is not open');
        const read = () => dialog.querySelector('.story-scene > p')?.textContent?.trim() ?? '';
        const shown = [read()];
        Object.assign(window, { shownYears: shown });
        new MutationObserver(() => {
          const year = read();
          if (shown.at(-1) !== year) shown.push(year);
        }).observe(dialog, { subtree: true, childList: true, characterData: true });
      });
      await page.keyboard.press('ArrowRight');
      await expect(player.getByRole('heading', { level: 2 })).toHaveText('Paul MOREAU');
      await expect(player.locator('.story-scene > p').first()).toHaveText(arrival);
      return page.evaluate(() => (window as unknown as { shownYears: string[] }).shownYears);
    }

    const moving = await openTheStory();
    const [from = '', to = ''] = moving.markers;
    expect(await animationNames(page, '.story-scene')).toEqual(['story-in']);
    // Without the preference, the clock runs through the years in between.
    expect((await yearsOnTheWay(moving.player, to)).length).toBeGreaterThan(3);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await openTheStory();
    expect(await animationNames(page, '.story-scene')).toEqual(['none']);
    expect(await yearsOnTheWay(still.player, to)).toEqual([from, to]);
  });
});

test.describe('without a mouse', () => {
  test('the timeline is reached, seen and zoomed from the keyboard', async ({ page }) => {
    await page.goto('/demo');
    const timeline = page.getByRole('application', { name: /Chronologie/ });
    await expect(timeline).toBeVisible();
    await tabTo(page, timeline);

    const legend = page.getByText(/personnes · molette/);
    await expect(legend).toContainText('une barre par vie');
    for (let step = 0; step < 8; step += 1) await page.keyboard.press('=');
    await expect(legend).toContainText('noms et événements');
    for (let step = 0; step < 8; step += 1) await page.keyboard.press('-');
    await expect(legend).toContainText('une barre par vie');
  });

  test.describe(() => {
    test.use({ storageState: EDITING_STATE_PATH });

    test('an owner invites someone, and takes it back, from the keyboard', async ({ page }) => {
      const stamp = Date.now();
      const email = `e2e-keyboard-${stamp}@chronolignee.invalid`;
      await page.goto('/app');
      await createTree(page, `Clavier ${stamp}`);
      const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';
      await page.goto(`/app/${slug}/partage`);

      const address = page.getByLabel('Adresse e-mail');
      await tabTo(page, address);
      await page.keyboard.type(email);
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Rôle')).toBeFocused();
      // From "Lecteur", the one above: the hint follows the choice.
      await page.keyboard.press('ArrowUp');
      await expect(page.getByLabel('Rôle')).toHaveValue('CONTRIBUTOR');
      await expect(page.getByText('Ajoute et corrige, sans jamais rien retirer.')).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Créer le lien' })).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(page.getByLabel('Lien d’invitation')).toHaveValue(/\/invitation\//);
      const pending = page.getByRole('list', { name: 'Invitations en attente' });
      await expect(pending).toContainText(email);
      await expect(pending).toContainText('Contributeur');

      const cancel = page.getByRole('button', { name: `Annuler l’invitation de ${email}` });
      await tabTo(page, cancel);
      await page.keyboard.press('Enter');
      await expect(page.getByText('Aucune invitation en attente.')).toBeVisible();
    });
  });
});
