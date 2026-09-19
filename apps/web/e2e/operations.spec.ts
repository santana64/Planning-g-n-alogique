import { expect, test } from '@playwright/test';

/**
 * What an orchestrator asks of the web container.
 *
 * Liveness answers without touching anything; readiness answers only when the
 * database and the object store do, and says which one is down without
 * saying anything else about it.
 */

test('says it is alive without asking anything else', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('says it is ready when the database and the object store answer', async ({ request }) => {
  const response = await request.get('/api/health/ready');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: 'ok',
    checks: { database: 'ok', storage: 'ok' },
  });
});

test('answers a malformed id with the page that does not exist, not a server error', async ({
  page,
  request,
}) => {
  // The database refuses a malformed uuid with an error; reaching it turned
  // a mistyped address into a 500.
  expect((await page.goto('/app/famille-chassagne-demo/personnes/not-a-uuid'))?.status()).toBe(404);
  const document = await request.get('/api/trees/famille-chassagne-demo/documents/not-a-uuid');
  expect(document.status()).toBe(404);
});
