import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type FullConfig } from '@playwright/test';

/**
 * One account for the whole run, created before any worker starts.
 *
 * The obvious version signs up in `beforeAll` and saves the session to a file.
 * That runs once *per worker*, and every worker writes the same path — so with
 * three workers the file is being rewritten while another worker is reading it
 * to build its browser context. The symptom was a single test failing in two
 * runs out of four, which is exactly how a file race presents itself.
 *
 * Doing it here also keeps the run to one sign-up. That matters: sign-up is
 * rate-limited per IP, and a suite that spends the budget on itself either
 * fails or pressures someone into loosening a limit that exists for a reason.
 */

export const EDITING_STATE_PATH = fileURLToPath(new URL('./.auth/editing.json', import.meta.url));

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3100';

  await mkdir(dirname(EDITING_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  const email = `e2e-crud-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`;
  await page.goto('/sign-up');
  await page.getByLabel('Nom').fill('Test CRUD');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(`E2e-${Date.now()}-abcdefgh`);
  await page.getByRole('button', { name: 'Créer un compte' }).click();

  // Fail loudly here rather than letting every editing test die separately
  // with a timeout that says nothing about the account never existing.
  await expect(page).toHaveURL(/\/app/, { timeout: 30_000 });

  await context.storageState({ path: EDITING_STATE_PATH });
  await context.close();
  await browser.close();
}
