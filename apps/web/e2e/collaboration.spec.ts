import { expect, test, type Browser, type Page } from '@playwright/test';
import { EDITING_STATE_PATH } from './global-setup';
import { addPerson, createTree, fillStable, signUp } from './helpers';
import { waitForMail } from './mailpit';

/**
 * Several people, one tree, and what each may do.
 *
 * The owner is the account every editing test shares. The others are signed
 * up here, in contexts of their own — as few as the story needs, because
 * sign-up is rate-limited per IP.
 *
 * The permission table is tested through the interface and, where it matters,
 * around it: a contributor's crafted request to delete is sent straight to
 * the server action, because a hidden button proves nothing.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ storageState: EDITING_STATE_PATH });

const PASSWORD = `E2e-${Date.now()}-collaboration`;

async function stranger(browser: Browser): Promise<Page> {
  // Explicitly no session: without it the context inherits the owner's.
  const context = await browser.newContext({ storageState: undefined });
  return context.newPage();
}

function personIdOf(page: Page): string {
  const match = /\/personnes\/([0-9a-f-]{36})/.exec(page.url());
  if (!match?.[1]) throw new Error(`not a person page: ${page.url()}`);
  return match[1];
}

test.describe('sharing a tree', () => {
  test('each role does what it may, and the server refuses the rest', async ({ page, browser }) => {
    const stamp = Date.now();
    const treeName = `Partage ${stamp}`;
    await page.goto('/app');
    await createTree(page, treeName);
    const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';

    await addPerson(page, { given: 'Jeanne', surname: 'Vasseur', birth: '1850', death: '1921' });
    const jeanne = personIdOf(page);
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Témoin', surname: 'Vasseur', birth: '1852', death: '1930' });
    const temoin = personIdOf(page);

    // --- The owner invites a contributor --------------------------------
    await page.getByRole('link', { name: 'Partage' }).click();
    const email = `e2e-invitee-${stamp}@chronolignee.invalid`;
    await fillStable(page, 'Adresse e-mail', email);
    await page.getByLabel('Rôle', { exact: true }).selectOption('CONTRIBUTOR');
    await page.getByRole('button', { name: 'Créer le lien' }).click();
    const link = await page.getByLabel('Lien d’invitation').inputValue();
    expect(link).toMatch(/\/invitation\/[A-Za-z0-9_-]{43}$/);
    await expect(page.getByRole('list', { name: 'Invitations en attente' })).toContainText(email);

    // The invitation also leaves by mail, with the same link and the name of
    // the tree — and the inviter keeps the link, because a message can be
    // lost and the family may already have a channel of its own.
    const invitation = await waitForMail(email, { subject: /invitation à/i });
    expect(invitation.subject).toContain(treeName);
    expect(invitation.text).toContain(link);
    expect(invitation.text).toContain('comme contributeur');

    // --- The invitee joins through the link -----------------------------
    const guest = await stranger(browser);
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(`Rejoindre « ${treeName} »`);
    // The address, recognisable to its owner and little else.
    await expect(guest.getByText(/adressée à e•••@chronolignee\.invalid/)).toBeVisible();
    await guest.getByRole('link', { name: 'Créer un compte' }).click();
    await signUp(guest, { name: 'Invitée E2E', email, password: PASSWORD });
    await guest.waitForURL(/\/invitation\//, { timeout: 30_000 });
    await guest.getByRole('button', { name: `Rejoindre « ${treeName} »` }).click();
    await guest.waitForURL(new RegExp(`/app/${slug}/personnes`), { timeout: 30_000 });
    await expect(guest.getByText('Jeanne VASSEUR')).toBeVisible();

    // A link works once.
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByText('Cette invitation a déjà servi.', { exact: false })).toBeVisible();

    // --- A contributor adds and corrects, never removes ------------------
    await guest.goto(`/app/${slug}/personnes/${jeanne}`);
    await expect(guest.getByLabel('Visibilité')).toBeVisible();
    // Publishing a living person or restricting someone is not theirs to do.
    await expect(guest.getByLabel('Visibilité').locator('option')).toHaveText([
      'Selon la règle de l’arbre',
      'Membres de l’arbre seulement',
    ]);
    await expect(
      guest.getByRole('button', { name: 'Retirer cette personne de l’arbre' }),
    ).toHaveCount(0);
    await expect(guest.getByRole('link', { name: 'Réglages' })).toHaveCount(0);

    // The owner removes the witness, and the request is kept as it was sent.
    let captured: { url: string; headers: Record<string, string>; body: Buffer } | null = null;
    page.on('request', (request) => {
      const body = request.postDataBuffer();
      if (
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        body?.includes(temoin)
      ) {
        captured = { url: request.url(), headers: request.headers(), body };
      }
    });
    await page.goto(`/app/${slug}/personnes/${temoin}`);
    await page.getByRole('button', { name: 'Retirer cette personne de l’arbre' }).click();
    await page.getByLabel(/pour confirmer/).fill('Témoin VASSEUR');
    await page.getByRole('button', { name: 'Retirer définitivement de l’arbre' }).click();
    await page.waitForURL(new RegExp(`/app/${slug}/personnes$`), { timeout: 30_000 });
    await expect(page.getByText('Témoin VASSEUR')).toHaveCount(0);
    expect(captured).not.toBeNull();

    // The same request, aimed at Jeanne, sent with the contributor's session.
    const sent = captured as unknown as {
      url: string;
      headers: Record<string, string>;
      body: Buffer;
    };
    const retarget = (text: string) => text.replaceAll(temoin, jeanne);
    const headers = Object.fromEntries(
      Object.entries(sent.headers)
        .filter(([name]) => name !== 'cookie' && name !== 'content-length')
        .map(([name, value]) => [name, retarget(value)]),
    );
    const forged = await guest.request.post(retarget(sent.url), {
      headers,
      data: Buffer.from(retarget(sent.body.toString('latin1')), 'latin1'),
    });
    expect(await forged.text()).toContain('pas de supprimer');
    await page.goto(`/app/${slug}/personnes/${jeanne}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jeanne VASSEUR');

    // --- A restricted person is invisible below the administrators -------
    await page.getByLabel('Visibilité').selectOption('RESTRICTED');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Jeanne VASSEUR a été enregistré.')).toBeVisible();
    await expect(
      page.getByText('Visible du seul propriétaire et des administrateurs.'),
    ).toBeVisible();

    await guest.goto(`/app/${slug}/personnes`);
    await expect(guest.getByText('Personne protégée')).toBeVisible();
    await expect(guest.getByText('Jeanne')).toHaveCount(0);
    await guest.goto(`/app/${slug}/personnes/${jeanne}`);
    await expect(guest.getByText('Cette personne est protégée.', { exact: false })).toBeVisible();
    await expect(guest.getByLabel('Visibilité')).toHaveCount(0);

    // --- The owner makes them a reader -----------------------------------
    await page.goto(`/app/${slug}/partage`);
    const roleForm = page.locator('form', { has: page.getByLabel('Rôle de Invitée E2E') });
    await roleForm.getByLabel('Rôle de Invitée E2E').selectOption('VIEWER');
    await roleForm.getByRole('button', { name: 'Changer' }).click();
    await expect(page.getByText('Rôle modifié.')).toBeVisible();

    await guest.goto(`/app/${slug}/personnes`);
    await expect(guest.getByRole('link', { name: 'Ajouter une personne' })).toHaveCount(0);
    // Members see who else is in the tree, but not their addresses: only
    // their own. The owner's is the shared E2E account's, e2e-crud-….
    await guest.goto(`/app/${slug}/partage`);
    const members = guest.getByRole('list', { name: 'Membres' });
    await expect(members).toContainText('Test CRUD');
    await expect(members).toContainText(email);
    await expect(members).not.toContainText('e2e-crud-');
    await expect(guest.getByRole('button', { name: 'Créer le lien' })).toHaveCount(0);

    // --- The history says who did what ----------------------------------
    await page.goto(`/app/${slug}/historique`);
    const history = page.locator('main');
    await expect(history).toContainText('Invitée E2E a rejoint l’arbre comme contributeur');
    await expect(history).toContainText(
      'Test CRUD a changé le rôle d’Invitée E2E : contributeur → lecteur',
    );
    await expect(history).toContainText('Test CRUD a retiré Témoin VASSEUR de l’arbre');
    await expect(history).toContainText('visibilité');

    await guest.context().close();
  });
});

test.describe('the tree’s settings', () => {
  test('opens a tree by link, exports it, and deletes it on its name', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const treeName = `Réglages ${stamp}`;
    await page.goto('/app');
    await createTree(page, treeName);
    const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';
    await addPerson(page, { given: 'Auguste', surname: 'Moreau', birth: '1843', death: '1910' });
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Lina', surname: 'Moreau', birth: '1994', living: true });

    // Private: a stranger gets the page that does not exist.
    const visitor = await stranger(browser);
    expect((await visitor.goto(`/app/${slug}/personnes`))?.status()).toBe(404);

    await page.getByRole('link', { name: 'Réglages' }).click();
    await page.getByLabel('Par lien').check();
    await page.getByRole('button', { name: 'Enregistrer les réglages' }).click();
    await expect(page.getByText('Réglages enregistrés.')).toBeVisible();

    // By link: readable, with the living person protected.
    await visitor.goto(`/app/${slug}/personnes`);
    await expect(visitor.getByText('Auguste MOREAU')).toBeVisible();
    await expect(visitor.getByText('Personne protégée')).toBeVisible();
    expect(await visitor.content()).not.toContain('Lina');
    await visitor.context().close();

    // The export: everyone, the living included, as GEDCOM 7.
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Télécharger le fichier GEDCOM' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`^${slug}-\\d{4}-\\d{2}-\\d{2}\\.ged$`));
    const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
    expect(text.startsWith('0 HEAD')).toBe(true);
    expect(text).toContain('2 VERS 7.0');
    expect(text).toMatch(/NAME Auguste \/Moreau\//i);
    expect(text).toMatch(/NAME Lina \/Moreau\//i);

    await page.goto(`/app/${slug}/historique`);
    await expect(page.locator('main')).toContainText(
      'a exporté l’arbre au format GEDCOM (2 personnes)',
    );
    await expect(page.locator('main')).toContainText('lecture');

    // Deleting it: nothing until the name is typed exactly.
    await page.goto(`/app/${slug}/reglages`);
    const erase = page.getByRole('button', { name: 'Supprimer définitivement l’arbre' });
    await page.getByLabel(/pour confirmer/).fill('Réglages');
    await expect(erase).toBeDisabled();
    await page.getByLabel(/pour confirmer/).fill(treeName);
    await erase.click();
    await page.waitForURL(/\/app$/, { timeout: 30_000 });
    await expect(page.getByText(treeName)).toHaveCount(0);
    expect((await page.goto(`/app/${slug}/personnes`))?.status()).toBe(404);
  });
});

test.describe('one’s own account', () => {
  test('downloads what it holds, then erases it with its lone tree', async ({ browser }) => {
    const stamp = Date.now();
    const email = `e2e-erase-${stamp}@chronolignee.invalid`;
    const page = await stranger(browser);
    await page.goto('/sign-up');
    await signUp(page, { name: 'Compte à effacer', email, password: PASSWORD });
    await page.waitForURL(/\/app/, { timeout: 30_000 });
    await createTree(page, `Seul ${stamp}`);
    const slug = /\/app\/([^/]+)\/personnes/.exec(page.url())?.[1] ?? '';

    await page.goto('/compte');
    await expect(page.getByRole('heading', { name: 'Mon compte', exact: true })).toBeVisible();
    // What the instance does with text, said before anyone is asked to trust it.
    await expect(page.getByRole('heading', { name: 'Lecture automatique' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Télécharger mes données' }).click();
    const data = JSON.parse(
      await (await import('node:fs/promises')).readFile(await (await download).path(), 'utf8'),
    ) as { account: { email: string }; memberships: Array<{ role: string }> };
    expect(data.account.email).toBe(email);
    expect(data.memberships).toEqual([expect.objectContaining({ role: 'OWNER' })]);

    // The lone tree goes with the account, and the page says so first.
    await expect(page.getByText(`« Seul ${stamp} »`)).toBeVisible();
    const erase = page.getByRole('button', { name: 'Supprimer définitivement mon compte' });
    await expect(erase).toBeDisabled();
    await page.getByLabel(/pour confirmer/).fill(email);
    await erase.click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 });

    // Gone: the session, the account, the tree.
    await page.goto('/app');
    await expect(page).toHaveURL(/sign-in/);
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect((await page.goto(`/app/${slug}/personnes`))?.status()).toBe(404);
    await page.context().close();
  });
});
