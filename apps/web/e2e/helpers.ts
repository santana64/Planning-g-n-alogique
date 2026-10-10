import { expect, type Page } from '@playwright/test';
import { waitForMailLink } from './mailpit';

/**
 * Fill a field and check the value actually stayed.
 *
 * Playwright's `fill` waits for the element to be visible and editable, which
 * a server-rendered input is well before React has hydrated it. Type into that
 * window and hydration replaces the value with the `defaultValue` it was
 * rendered with — silently, and only under load, which is why this showed up
 * as one test failing in half the parallel runs and never once serially.
 *
 * Asserting the value and retrying is the honest fix: it says what the step
 * actually requires rather than sleeping and hoping.
 */
export async function fillStable(page: Page, label: string, value: string): Promise<void> {
  // Exact, then first: "Date" must not also match "Date de naissance", and
  // "Prénom(s)" legitimately appears once per name block.
  const field = page.getByLabel(label, { exact: true }).first();
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 750 });
  }).toPass({ timeout: 15_000 });
}

export async function createTree(page: Page, name: string): Promise<void> {
  await fillStable(page, 'Nom de l’arbre', name);
  await page.getByRole('button', { name: 'Créer l’arbre' }).click();
  await expect(page).toHaveURL(/\/personnes/);
}

export async function addPerson(
  page: Page,
  fields: {
    given: string;
    surname: string;
    birth?: string;
    death?: string;
    living?: boolean;
    sex?: 'FEMALE' | 'MALE';
  },
): Promise<void> {
  await page.getByRole('link', { name: 'Ajouter une personne' }).click();
  // On the new page before typing: a person's record carries an edit form
  // with the very same labels. While a slower navigation was still in flight,
  // this filled the previous person's form, and then submitted the new one
  // empty — found by slowing that navigation down on purpose.
  await page.waitForURL(/\/personnes\/nouvelle$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nouvelle personne');
  await fillStable(page, 'Prénom(s)', fields.given);
  await fillStable(page, 'Nom de famille', fields.surname);
  if (fields.sex) await page.getByLabel('Sexe inscrit à l’état civil').selectOption(fields.sex);
  if (fields.birth) await fillStable(page, 'Date de naissance', fields.birth);
  if (fields.death) await fillStable(page, 'Date de décès', fields.death);
  if (fields.living) await page.getByLabel('Statut').selectOption('LIVING');
  else if (fields.death) await page.getByLabel('Statut').selectOption('DECEASED');
  await page.getByRole('button', { name: 'Créer la personne' }).click();

  // Wait for whichever comes first: the navigation, or the form saying why it
  // refused. Checking for the error immediately after the click is useless —
  // nothing has rendered yet, the count is zero, and the real message arrives
  // seconds later to nobody watching. Racing the two turns "timed out waiting
  // for a URL" into the sentence the form was already displaying.
  const refusal = page.locator('form').getByText(/échoué|invalide|Connectez|existe pas/);
  await Promise.race([
    page.waitForURL(/\/personnes\/[0-9a-f]{8}-/, { timeout: 30_000 }).catch(() => undefined),
    refusal.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined),
  ]);
  await expect(refusal).toHaveCount(0);
  // Thirty seconds, not five: the first server action after a cold `next
  // start` pays for compilation, and reporting that as "the write failed"
  // sends the next person reading this to debug the wrong thing. The
  // assertion is unchanged — it must still navigate.
  await page.waitForURL(/\/personnes\/[0-9a-f]{8}-/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(fields.surname.toUpperCase());
}

/**
 * Sign up in a context of its own, address confirmed.
 *
 * Kept to the tests that need a second person — an invitee, an account to
 * erase — because sign-up is rate-limited per IP and every call here spends
 * one of twenty an hour.
 *
 * The confirmation is part of signing up here because it is part of signing
 * up in production: the instance can send, so an unconfirmed account cannot
 * sign in. The link is read from Mailpit, which caught the message.
 */
export async function signUp(
  page: Page,
  account: { name: string; email: string; password: string },
  /** Where confirming the address lands: the application, or an invitation. */
  landsOn: RegExp = /\/app|\/invitation\//,
): Promise<void> {
  await page.getByLabel('Nom').fill(account.name);
  await page.getByLabel('Adresse e-mail').fill(account.email);
  await page.getByLabel('Mot de passe').fill(account.password);
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await expect(page.getByText(/lien de confirmation/i)).toBeVisible();

  await page.goto(await waitForMailLink(account.email, { subject: /confirmez votre adresse/i }));
  await page.waitForURL(landsOn, { timeout: 30_000 });
}

/**
 * Wait until every CSS animation on the page has finished.
 *
 * Accessibility checks measure contrast as rendered: run halfway through a
 * fade-in, they report the text at 30 % opacity as unreadable, which is true
 * of that frame and of nothing a reader sees.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
}

/**
 * Open the command palette with its shortcut.
 *
 * The listener is attached when the page hydrates; a shortcut pressed a few
 * milliseconds earlier goes nowhere. Pressing again until the box appears is
 * what a person does, and says exactly what the step needs.
 */
export async function openPalette(page: Page): Promise<void> {
  const box = page.getByRole('combobox', { name: /Chercher une personne|Search for a person/ });
  await expect(async () => {
    if (!(await box.isVisible())) await page.keyboard.press('ControlOrMeta+k');
    await expect(box).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
