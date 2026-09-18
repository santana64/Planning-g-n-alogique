import { expect, test, type Page } from '@playwright/test';
import { EDITING_STATE_PATH } from './global-setup';

/**
 * Manual genealogy editing, end to end.
 *
 * The journey a first user actually makes: create an account, create a tree,
 * type in an ancestor, type in their child, link them, and see both on the
 * timeline. Every step here failed for a real reason at some point during
 * development, which is why each is asserted rather than assumed.
 *
 * One account for the run, a fresh tree per test. The isolation that matters
 * is the data — a suite whose tests inherit each other's people goes red for
 * reasons unrelated to the code — and that is what a per-test tree gives.
 *
 * Signing up per test buys no more isolation and costs something real:
 * sign-up is rate-limited per IP, and a suite that spends the whole budget on
 * itself either fails or pressures someone into loosening a limit that exists
 * for a reason.
 */

/**
 * A longer budget than the default thirty seconds.
 *
 * These tests are genuinely heavier than a page-load assertion: each creates a
 * tree, two or three people and the links between them, every step a real
 * write through a real transaction. The per-step waits below stay comfortably
 * under this number — setting one equal to the test budget means the test dies
 * before the step can report what went wrong.
 */
test.describe.configure({ timeout: 90_000 });

// The account is created once per run by the global setup, not per worker:
// several workers writing one session file is a race, and it showed up as a
// single test failing in half the runs.
test.use({ storageState: EDITING_STATE_PATH });

/**
 * Surface what the browser saw.
 *
 * These tests fail by waiting for something the client never did — a
 * navigation, a combobox opening — and a timeout says nothing about why. An
 * uncaught client error or a React hydration mismatch is exactly the kind of
 * cause that produces that symptom and leaves no trace on the server.
 */
const clientErrors: string[] = [];

test.beforeEach(({ page }) => {
  clientErrors.length = 0;
  page.on('pageerror', (error) => clientErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') clientErrors.push(`console: ${message.text()}`);
  });
});

// eslint-disable-next-line no-empty-pattern -- Playwright passes testInfo second.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && clientErrors.length > 0) {
    const report = clientErrors.join('\n');
    testInfo.annotations.push({ type: 'client errors', description: report });
    // eslint-disable-next-line no-console
    console.log(`\n--- browser errors during this test ---\n${report}`);
  }
});

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
async function fillStable(page: Page, label: string, value: string): Promise<void> {
  // Exact, then first: "Date" must not also match "Date de naissance", and
  // "Prénom(s)" legitimately appears once per name block.
  const field = page.getByLabel(label, { exact: true }).first();
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 750 });
  }).toPass({ timeout: 15_000 });
}

async function createTree(page: Page, name: string): Promise<void> {
  await fillStable(page, 'Nom de l’arbre', name);
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
    await fillStable(page, 'Le parent', 'Jean-Baptiste');
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
    await fillStable(page, 'Le parent', 'Mathurin');
    await page.getByRole('option', { name: /Mathurin ANCIEN/ }).click();
    await page.getByRole('button', { name: 'Créer le lien' }).click();
    await expect(page.getByText('Le lien a été créé.')).toBeVisible();

    // Now the other way round, which closes the loop.
    await page.getByRole('link', { name: 'Mathurin ANCIEN' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mathurin ANCIEN');
    await page.getByLabel('Sens du lien').selectOption('CHILD_OF');
    await fillStable(page, 'Le parent', 'Perrine');
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
    await fillStable(page, 'Le parent', 'Victoire');
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
    await fillStable(page, 'Date', '14 mai 1871');
    await fillStable(page, 'Lieu', 'Tours');
    await fillStable(page, 'Avec', 'Paul');
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

    await fillStable(page, 'Date de naissance', '');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('a été enregistré')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fausse DATE');
    await expect(page.getByText('1834')).toHaveCount(0);
  });

  test('numbers an ancestry and shows where the lines rejoin', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Sosa ${Date.now()}`);

    await addPerson(page, { given: 'Enfant', surname: 'Sujet', birth: '1900' });
    const subjectUrl = page.url();
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Pere', surname: 'Sujet', birth: '1870', sex: 'MALE' });
    const fatherUrl = page.url();
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Mere', surname: 'Sujet', birth: '1875', sex: 'FEMALE' });

    // Mother is on screen; link her to the child, then the father.
    await page.goto(subjectUrl);
    await page.getByLabel('Sens du lien').selectOption('CHILD_OF');
    await fillStable(page, 'Le parent', 'Mere');
    await page.getByRole('option', { name: /Mere SUJET/ }).click();
    await page.getByRole('button', { name: 'Créer le lien' }).click();
    await expect(page.getByText('Le lien a été créé.')).toBeVisible();

    await page.goto(fatherUrl);
    await page.getByLabel('Sens du lien').selectOption('PARENT_OF');
    await fillStable(page, 'L’autre personne', 'Enfant');
    await page.getByRole('option', { name: /Enfant SUJET/ }).click();
    await page.getByRole('button', { name: 'Créer le lien' }).click();
    await expect(page.getByText('Le lien a été créé.')).toBeVisible();

    await page.goto(`${subjectUrl}/ascendance`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ascendance');

    // The father takes 2 and the mother 3, from their recorded sex — not from
    // whichever link happened to be created first.
    const generation1 = page.getByRole('listitem').filter({ hasText: 'Pere SUJET' });
    await expect(generation1).toContainText('2');
    const motherSlot = page.getByRole('listitem').filter({ hasText: 'Mere SUJET' });
    await expect(motherSlot).toContainText('3');

    // And the positions nobody fills are shown rather than omitted: they are
    // what the researcher came to see.
    await expect(page.getByText('Inconnu').first()).toBeVisible();
  });

  test('places a dated ancestor in time and lists an undated one apart', async ({ page }) => {
    await page.goto('/app');
    await createTree(page, `Eventail ${Date.now()}`);

    await addPerson(page, { given: 'Enfant', surname: 'Temps', birth: '1900' });
    const subjectUrl = page.url();
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    await addPerson(page, { given: 'Pere', surname: 'Temps', birth: '1870', sex: 'MALE' });
    await page.getByRole('link', { name: 'Toutes les personnes' }).click();
    // No birth date: the one thing the fan cannot place.
    await addPerson(page, { given: 'Mere', surname: 'Temps', sex: 'FEMALE' });

    await page.goto(subjectUrl);
    for (const parent of ['Pere', 'Mere']) {
      await page.getByLabel('Sens du lien').selectOption('CHILD_OF');
      await fillStable(page, 'Le parent', parent);
      await page.getByRole('option', { name: new RegExp(`${parent} TEMPS`) }).click();
      await page.getByRole('button', { name: 'Créer le lien' }).click();
      await expect(page.getByText('Le lien a été créé.')).toBeVisible();
      await page.goto(subjectUrl);
    }

    await page.getByRole('link', { name: 'Éventail temporel →' }).click();
    const chart = page.getByRole('figure', { name: /Éventail temporel de Enfant TEMPS/ });
    await expect(chart).toBeVisible();
    const drawing = chart.locator('svg');
    await expect(drawing.getByText('Pere TEMPS', { exact: true })).toBeVisible();

    // The mother is in the ancestry but has no year to stand on. Drawing her
    // anyway would put her at a date nobody recorded.
    await expect(drawing.getByText('Mere TEMPS', { exact: true })).toHaveCount(0);
    const unplaced = page.getByRole('region', { name: 'Non placés' });
    await expect(unplaced.getByRole('listitem').filter({ hasText: 'Mere TEMPS' })).toContainText(
      'naissance non datée',
    );
  });

  test('sources a fact, and counts what is still unsourced', async ({ page }) => {
    await page.goto('/app');
    const treeName = `Sources ${Date.now()}`;
    await createTree(page, treeName);
    await addPerson(page, { given: 'Sourcee', surname: 'Personne', birth: '12 juin 1822' });
    const personUrl = page.url();

    // Nothing is cited yet, and the archive says so rather than staying quiet.
    await page.getByRole('link', { name: 'Archives' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Archives');
    await expect(page.getByText('0 %')).toBeVisible();

    await fillStable(page, 'Titre', 'Registre paroissial de Tours 1820-1825');
    await fillStable(page, 'Cote', '6 NUM 7/261/003');
    await page.getByRole('button', { name: 'Ajouter la source' }).click();
    await expect(page.getByText('6 NUM 7/261/003').first()).toBeVisible();

    // Back to the record: the citation is attached to the event, not to the
    // person — a register page proves a baptism, not a whole life.
    await page.goto(personUrl);
    await expect(page.getByText('Aucune source pour cet événement').first()).toBeVisible();
    await page.getByRole('button', { name: 'Citer une source' }).first().click();
    await fillStable(page, 'Où exactement', 'vue 118, acte 7');
    await page.getByRole('button', { name: 'Enregistrer la citation' }).click();
    await expect(page.getByText('La citation a été enregistrée.')).toBeVisible();

    await page.reload();
    await expect(page.getByText('vue 118, acte 7').first()).toBeVisible();

    // And the coverage figure moved, which is the number that says what the
    // research is worth.
    await page.getByRole('link', { name: 'Archives' }).click();
    await expect(page.getByText('0 %')).toHaveCount(0);
  });

  test('reads a cited transcription into proposals that change nothing until accepted', async ({
    page,
  }) => {
    await page.goto('/app');
    await createTree(page, `Lecture ${Date.now()}`);
    // Entered with the year the family remembered, before anyone read the act.
    await addPerson(page, { given: 'Jean-Baptiste', surname: 'Chassagne', birth: '1823' });
    const personUrl = page.url();

    await page.getByRole('link', { name: 'Archives' }).click();
    await fillStable(page, 'Titre', 'Registre de Tours 1822');
    await fillStable(page, 'Cote', '6 NUM 7/261/003');
    await page.getByRole('button', { name: 'Ajouter la source' }).click();
    await expect(page.getByText('6 NUM 7/261/003').first()).toBeVisible();

    // The transcription is typed onto a citation, so every proposal made from
    // it has a source and a locator before anyone is asked to judge it.
    await page.goto(personUrl);
    await page.getByRole('button', { name: 'Citer une source' }).first().click();
    await fillStable(page, 'Où exactement', 'vue 118');
    await fillStable(
      page,
      'Transcription',
      'né le 12 juin 1822 à Tours, fils de Pierre Chassagne et de Marie Lefèvre',
    );
    await page.getByRole('button', { name: 'Enregistrer la citation' }).click();
    await expect(page.getByText('La citation a été enregistrée.')).toBeVisible();

    await page.reload();
    // Before pressing anything, the page says where the text will go.
    await expect(page.getByText(/rien ne quitte ce serveur/).first()).toBeVisible();
    await page
      .getByRole('button', { name: 'Proposer des faits à partir de cette transcription' })
      .click();
    await expect(page.getByText(/propositions? à examiner\./).first()).toBeVisible();

    // Nothing has changed yet. The record still says what was typed.
    await page.reload();
    await expect(page.getByRole('heading', { name: /propositions? à examiner/ })).toBeVisible();
    await expect(page.getByText('1823 — —')).toBeVisible();

    const birth = page.getByRole('article', { name: 'Date de naissance : 12 juin 1822' });
    // The reviewer judges the words, shown beside the value.
    await expect(birth.getByText(/né le 12 juin 1822/)).toBeVisible();
    await expect(birth.getByText(/Lecture par règles/)).toBeVisible();
    await birth.getByRole('button', { name: 'Accepter', exact: true }).click();
    await expect(page.getByText(/Le fait est enregistré avec sa source/)).toBeVisible();

    const place = page.getByRole('article', { name: 'Lieu de naissance : Tours' });
    await place.getByRole('button', { name: 'Rejeter' }).click();
    await place.getByLabel(/Pourquoi/).fill('lieu du mariage, pas de la naissance');
    await place.getByRole('button', { name: 'Confirmer le rejet' }).click();
    await expect(page.getByText(/La proposition reste consultable/)).toBeVisible();

    // Accepted: the record now shows the register's date, and says what the
    // event typed earlier still records rather than hiding the disagreement.
    await page.reload();
    await expect(page.getByText('12 juin 1822 — —')).toBeVisible();
    await expect(page.getByText(/événement saisi indique « 1823 »/)).toBeVisible();
  });

  test('accepts a real image and refuses a file lying about its type', async ({
    page,
    request,
  }) => {
    await page.goto('/app');
    await createTree(page, `Documents ${Date.now()}`);
    const treeSlug = new URL(page.url()).pathname.split('/')[2];

    // A one-pixel PNG, byte for byte. The route reads the magic number rather
    // than trusting the name or the declared type.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const accepted = await request.post(`/api/trees/${treeSlug}/documents`, {
      multipart: {
        file: { name: 'acte.png', mimeType: 'image/png', buffer: png },
        title: 'Acte de naissance',
      },
    });
    expect(accepted.status()).toBe(200);

    // The same bytes again are the same document, not a second one.
    const again = await request.post(`/api/trees/${treeSlug}/documents`, {
      multipart: { file: { name: 'copie.png', mimeType: 'image/png', buffer: png } },
    });
    expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);

    // A script renamed to .png. The extension and the declared type both say
    // image; the first bytes do not, and those are what decide.
    const refused = await request.post(`/api/trees/${treeSlug}/documents`, {
      multipart: {
        file: {
          name: 'innocent.png',
          mimeType: 'image/png',
          buffer: Buffer.from('#!/bin/sh\necho hello\n'),
        },
      },
    });
    expect(refused.status()).toBe(415);

    // The archive lists what was accepted, once — the duplicate did not
    // create a second row, and the refused file created none.
    await page.goto(`/app/${treeSlug}/archives`);
    await expect(page.getByText('Acte de naissance').first()).toBeVisible();
    await expect(page.getByText('innocent.png')).toHaveCount(0);
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
