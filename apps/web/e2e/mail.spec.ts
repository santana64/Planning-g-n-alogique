import { expect, test } from '@playwright/test';
import { waitForMail, waitForMailLink } from './mailpit';

/**
 * What happens by mail: confirming an address, and getting back in after
 * forgetting a password.
 *
 * Both are exercised as a person lives them — through a message caught by
 * Mailpit — because the part that breaks in production is never the endpoint,
 * it is the link: its address, its token, where it lands.
 *
 * One account for the whole file: signing up is rate-limited per address and
 * per IP, and a suite that spends that budget on itself starts failing for
 * reasons that have nothing to do with the product.
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const stamp = Date.now();
const EMAIL = `e2e-mail-${stamp}@chronolignee.invalid`;
const PASSWORD = `E2e-${stamp}-premier-mot-de-passe`;
const NEW_PASSWORD = `E2e-${stamp}-nouveau-mot-de-passe`;

test('an address must be confirmed, and the link comes again on request', async ({ page }) => {
  await page.goto('/sign-up');
  await page.getByLabel('Nom').fill('Courriel E2E');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer un compte' }).click();

  // The account exists but is not usable yet, and the page says so with the
  // address as it was typed — the commonest reason nothing arrives.
  await expect(page.getByText(/lien de confirmation/i)).toBeVisible();
  await expect(page.getByText(EMAIL)).toBeVisible();

  const first = await waitForMail(EMAIL, { subject: /confirmez votre adresse/i });
  expect(first.text).toContain("Si vous n'avez pas créé de compte");

  // Asking again sends another one.
  await page.getByRole('button', { name: 'Renvoyer le lien' }).click();
  await expect(page.getByText('Lien renvoyé.')).toBeVisible();

  // Signing in before confirming is refused — and explains itself rather
  // than reading as a wrong password.
  await page.goto('/sign-in');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText(/lien de confirmation/i)).toBeVisible();

  // Confirming lands in the application, signed in.
  await page.goto(await waitForMailLink(EMAIL, { subject: /confirmez votre adresse/i }));
  await expect(page).toHaveURL(/\/app/);
  // Signed in: the account is named and there is a way out.
  await expect(page.getByRole('link', { name: EMAIL })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
});

test('a forgotten password is recovered by mail, and the old one stops working', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await expect(page).toHaveURL(/mot-de-passe-oublie/);

  // The same answer whether or not the address has an account: this page is
  // not a way of finding out who is registered.
  const unknown = `e2e-nobody-${stamp}@chronolignee.invalid`;
  await page.getByLabel('Adresse e-mail').fill(unknown);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  const neutral = await page.locator('main').getByRole('status').textContent();
  expect(neutral).toMatch(/si un compte existe/i);

  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await expect(page.locator('main').getByRole('status')).toHaveText(neutral ?? '');

  // Nothing was sent to the address that has no account.
  await expect(waitForMail(unknown, { timeoutMs: 1_500 })).rejects.toThrow();

  await page.goto(await waitForMailLink(EMAIL, { subject: /réinitialiser votre mot de passe/i }));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('nouveau mot de passe');

  // Too short is refused here as it is on sign-up.
  await page.getByLabel('Nouveau mot de passe').fill('court');
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('12 caractères');

  await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText('Mot de passe enregistré');

  // The old password no longer opens the account; the new one does.
  await page.goto('/sign-in');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('incorrect');

  await page.getByLabel('Mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/app/);
});

test('the same link cannot be used twice', async ({ page }) => {
  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await expect(page.locator('main').getByRole('status')).toBeVisible();

  const link = await waitForMailLink(EMAIL, { subject: /réinitialiser votre mot de passe/i });
  await page.goto(link);
  await page.getByLabel('Nouveau mot de passe').fill(`${NEW_PASSWORD}-bis`);
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText('Mot de passe enregistré');

  // The second visit does not even offer the form: the link is spent, and
  // the page says so rather than taking a password it cannot save.
  await page.goto(link);
  await expect(page.locator('main').getByRole('alert')).toContainText("Ce lien n'est plus valable");
  await expect(page.getByLabel('Nouveau mot de passe')).toHaveCount(0);
});
