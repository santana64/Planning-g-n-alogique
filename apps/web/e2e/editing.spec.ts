import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Manual genealogy editing, end to end.
 *
 * The journey a first user actually makes: create an account, create a tree,
 * type in an ancestor, type in their child, link them, and see both on the
 * timeline. Every step here failed for a real reason at some point during
 * development, which is why each is asserted rather than assumed.
 *
 * One account for the file, a fresh tree per test. The isolation that matters
 * is the data — a suite whose tests inherit each other's people goes red for
 * reasons unrelated to the code — and that is what a per-test tree gives.
 *
 * Signing up per test does not buy more isolation and does cost something
 * real: sign-up is rate-limited per IP, and a suite that spends the whole
 * budget on itself either fails or pressures someone into loosening a limit
 * that exists for a reason.
 */

const STATE_PATH = fileURLToPath(new URL('./.auth/editing.json', import.meta.url));

async function signUp(page: Page): Promise<string> {
  const email = `e2e-crud-${Date.now()}-${Math.random().toString(36).slice(2)}@chronolignee.invalid`;
  await page.goto('/sign-up');
  await page.getByLabel('Nom').fill('Test CRUD');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(`E2e-${Date.now()}-abcdefgh`);
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await expect(page).toHaveURL(/\/app/);
  return email;
}

/** One sign-up for the file; every test then starts already signed in. */
test.beforeAll(async ({ browser }) => {
  // storageState: undefined explicitly — the file-level test.use below applies
  // to contexts opened in hooks too, and this one runs before the file exists.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await signUp(page);
  await context.storageState({ path: STATE_PATH });
  await context.close();
});

test.use({ storageState: STATE_PATH });

async function createTree(page: Page, name: string): Promise<void> {
  await page.getByLabel('Nom de l’arbre').fill(name);
  await page.getByRole('button', { name: 'Créer l’arbre' }).click();
  await expect(page).toHaveURL(/\/personnes/);
}

async function addPerson(
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
  await page.getByLabel('Prénom(s)').first().fill(fields.given);
  await page.getByLabel('Nom de famille').first().fill(fields.surname);
  if (fields.sex) await page.getByLabel('Sexe inscrit à l’état civil').selectOption(fields.sex);
  if (fields.birth) await page.getByLabel('Date de naissance').fill(fields.birth);
  if (fields.death) await page.getByLabel('Date de décès').fill(fields.death);
  if (fields.living) await page.getByLabel('Statut').selectOption('LIVING');
  else if (fields.death) await page.getByLabel('Statut').selectOption('DECEASED');
  await page.getByRole('button', { name: 'Créer la personne' }).click();

  // A refused write leaves the form in place with its reason on screen.
  // Asserted by count, not with `.not.toContainText` — that one fails when the
  // element does not exist at all, which is the passing case here and cost a
  // whole run of false failures to notice.
  await expect(page.locator('form').getByText(/échoué|invalide|Connectez/)).toHaveCount(0);
  await page.waitForURL(/\/personnes\/[0-9a-f]{8}-/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(fields.surname.toUpperCase());
}

test.describe('manual editing', () => {
  test('a new account can build a family from nothing', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Famille E2E ${Date.now()}`);

    await expect(page.getByText('Cet arbre est vide.')).toBeVisible();

    // A French date, typed the way a register writes it. The product's claim
    // is that this is parsed rather than rejected.
    await addPerson(page, {
      given: 'Jean-Baptiste',
      surname: 'Chassagne',
      birth: '12 juin 1822',
      death: '3 mars 1889',
    });

    // Surname in caps is the French genealogical convention, and the only
    // thing distinguishing the family name in "Jean MARTIN Pierre".
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jean-Baptiste CHASSAGNE');
    // Both ends of the life, formatted by the domain rather than echoed back.
    await expect(page.getByText('12 juin 1822 — 3 mars 1889')).toBeVisible();

    // The birth is an event, not a column: it appears in the event list.
    await expect(page.getByRole('heading', { name: 'Événements' })).toBeVisible();
    await expect(page.getByText('Naissance', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Adèle', surname: 'Chassagne', birth: '1849', death: '1912' });

    // Link the child to the parent, from the child's own point of view.
    await page.getByLabel('Sens du lien').selectOption('CHILD_OF');
    await page.getByLabel('Le parent').fill('Jean-Baptiste');
    await page.getByRole('option', { name: /Jean-Baptiste CHASSAGNE/ }).click();
    await page.getByRole('button', { name: 'Créer le lien' }).click();

    await expect(page.getByText('Le lien a été créé.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Jean-Baptiste CHASSAGNE' }).first()).toBeVisible();

    // And both now stand on the timeline, which is the point of the product.
    await page.getByRole('link', { name: 'Chronologie' }).click();
    await page.getByRole('button', { name: 'Voir le tableau' }).click();
    const table = page.getByRole('table');
    await expect(table.getByText('Jean-Baptiste CHASSAGNE')).toBeVisible();
    await expect(table.getByText('Adèle CHASSAGNE')).toBeVisible();
  });

  test('keeps a date it cannot read instead of dropping it', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Dates illisibles ${Date.now()}`);

    // "9 br 1889" is a real abbreviation problem: br could be brumaire or a
    // clerk's contraction of novembre. Inventing either would be a lie, and
    // discarding it would destroy the only evidence there is.
    await addPerson(page, { given: 'Léonie', surname: 'Blanchard', birth: '9 br 1889' });

    await expect(page.getByText('9 br 1889').first()).toBeVisible();
    await expect(page.getByText('date illisible')).toBeVisible();
  });

  test('refuses a link that would make someone their own ancestor', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Cycle ${Date.now()}`);

    await addPerson(page, { given: 'Mathurin', surname: 'Ancien', birth: '1702' });
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Perrine', surname: 'Cadette', birth: '1730' });

    await page.getByLabel('Sens du lien').selectOption('CHILD_OF');
    await page.getByLabel('Le parent').fill('Mathurin');
    await page.getByRole('option', { name: /Mathurin ANCIEN/ }).click();
    await page.getByRole('button', { name: 'Créer le lien' }).click();
    await expect(page.getByText('Le lien a été créé.')).toBeVisible();

    // Now the other way round, which closes the loop.
    await page.getByRole('link', { name: 'Mathurin ANCIEN' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mathurin ANCIEN');
    await page.getByLabel('Sens du lien').selectOption('CHILD_OF');
    await page.getByLabel('Le parent').fill('Perrine');
    await page.getByRole('option', { name: /Perrine CADETTE/ }).click();
    await page.getByRole('button', { name: 'Créer le lien' }).click();

    await expect(page.getByText('Ce lien rendrait l’arbre incohérent.')).toBeVisible();
    await expect(page.getByText(/propre ancêtre/)).toBeVisible();
  });

  test('reports an improbable age without refusing the record', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Âges ${Date.now()}`);

    // A mother of 58 is unusual and it happens. Refusing it would force the
    // researcher to falsify the register in order to store what it says. The
    // sex is recorded because the maternal bound is the one being tested; with
    // it unknown the validator correctly applies the wider paternal one.
    await addPerson(page, {
      given: 'Victoire',
      surname: 'Marchand',
      birth: '1799',
      death: '1871',
      sex: 'FEMALE',
    });
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, {
      given: 'Hippolyte',
      surname: 'Marchand',
      birth: '1857',
      death: '1901',
    });

    await page.getByLabel('Sens du lien').selectOption('CHILD_OF');
    await page.getByLabel('Le parent').fill('Victoire');
    await page.getByRole('option', { name: /Victoire MARCHAND/ }).click();
    await page.getByRole('button', { name: 'Créer le lien' }).click();

    // Written — and said out loud, which is the half that matters.
    await expect(page.getByText('Le lien a été créé.')).toBeVisible();
    // 57, not 58: the age is measured at the child's earliest possible birth,
    // the reading that cannot manufacture a violation. And Victoire is the one
    // named as being 57 — the parent, not the child.
    // Scoped to the form: this asserts the WRITE reported it, not merely that
    // the page audit noticed afterwards. The same sentence legitimately appears
    // twice — once as the write's answer, once in the record's own findings.
    await expect(
      page
        .locator('form')
        .getByText('Victoire MARCHAND aurait 57 ans à la naissance de Hippolyte MARCHAND'),
    ).toBeVisible();
  });

  test('records a marriage as one event belonging to two people', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Mariage ${Date.now()}`);

    await addPerson(page, { given: 'Paul', surname: 'Renard', birth: '1845', death: '1902' });
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Adèle', surname: 'Chassagne', birth: '1849', death: '1912' });

    await page.getByRole('button', { name: 'Ajouter un événement' }).click();
    await page.getByLabel('Type d’événement').selectOption('MARRIAGE');
    await page.getByLabel('Date', { exact: true }).fill('14 mai 1871');
    await page.getByLabel('Lieu', { exact: true }).fill('Tours');
    await page.getByLabel('Avec').fill('Paul');
    await page.getByRole('option', { name: /Paul RENARD/ }).click();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();

    await expect(page.getByText("L'événement a été ajouté.")).toBeVisible();
    // Exact, because the form's own hint quotes the same date as an example.
    await expect(page.getByText('14 mai 1871', { exact: true })).toBeVisible();

    // The union link was offered by the form and taken, so Paul is now on
    // Adèle's record as a spouse — the event is a date, the link is what the
    // graph walks, and the form asked rather than inferring.
    await expect(page.getByRole('heading', { name: 'Unions et fratrie' })).toBeVisible();

    // The same event, once, on the other person's page — not a second copy
    // with its own date free to drift.
    await page.getByRole('link', { name: 'Paul RENARD' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Paul RENARD');
    await expect(page.getByText('Mariage', { exact: true })).toBeVisible();
    await expect(page.getByText('14 mai 1871', { exact: true })).toBeVisible();
  });

  test('lets a wrong date be removed, not only overwritten', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Effacement ${Date.now()}`);

    // Emptying the field used to be indistinguishable from not sending it, so
    // the save reported success and kept the date. Deleting a wrong date
    // meant typing a different wrong date over it.
    await addPerson(page, { given: 'Fausse', surname: 'Date', birth: '1834' });
    await expect(page.getByText('1834').first()).toBeVisible();

    await page.getByLabel('Date de naissance').fill('');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('a été enregistré')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fausse DATE');
    await expect(page.getByText('1834')).toHaveCount(0);
  });

  test('does not publish a living person to someone outside the tree', async ({
    page,
    browser,
  }) => {
    await page.goto('/app');
    const treeName = `Vivants ${Date.now()}`;
    await createTree(page, treeName);
    await addPerson(page, { given: 'Camille', surname: 'Bertrand', birth: '1991', living: true });

    const url = page.url();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Camille BERTRAND');

    // A second, unrelated browser context: no session, no membership. The
    // explicit `storageState: undefined` is load-bearing — without it this
    // context inherits the signed-in state from test.use and the "stranger"
    // is actually the owner, which is how a redaction test passes while
    // testing nothing.
    //
    // A private tree must answer as though it does not exist, so that the
    // existence of someone's family archive is not confirmed by a 403.
    const stranger = await browser.newContext({ storageState: undefined });
    const strangerPage = await stranger.newPage();
    const response = await strangerPage.goto(url);
    expect(response?.status()).toBe(404);

    const body = await strangerPage.content();
    expect(body).not.toContain('Camille');
    expect(body).not.toContain('1991');
    await stranger.close();
  });
});
