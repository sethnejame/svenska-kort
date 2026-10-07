import { expect, test } from '@playwright/test';

/**
 * The point of the service worker is the T-bana: no signal between stations.
 * This visits once with a network, takes it away, and reloads.
 */
test('plays a deck with the network switched off', async ({ page, context }) => {
  await page.goto('./');
  await page.getByRole('textbox', { name: 'Visningsnamn' }).fill('Testare');
  await page.getByRole('button', { name: 'Kör igång' }).click();
  await expect(page.getByRole('heading', { name: 'Välj en lek' })).toBeVisible();

  // The worker claims the page asynchronously; without this the reload below
  // would race it and legitimately fail. `registration.active.state` can read
  // 'activated' a tick before this page's own `controller` is set — they cross
  // the SW/page IPC boundary separately — and it is `controller` that actually
  // decides whether a later fetch (the lazy leaderboard chunk, below) is
  // intercepted rather than sent to the now-offline network.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);

  // A deep link, not the root: hash routing means it is index.html either way,
  // but only if the fallback is wired up.
  await page.goto('./#/decks');
  await expect(page.getByRole('heading', { name: 'Välj en lek' })).toBeVisible();

  await page.getByRole('link', { name: /Mat och dryck/ }).click();
  await expect(page.getByRole('button', { name: /tryck för att vända kortet/ })).toBeVisible();

  // Lazily-loaded routes are the ones a naive precache misses.
  await page.goto('./#/leaderboard');
  await expect(page.getByRole('heading', { name: 'Topplista' })).toBeVisible();

  await context.setOffline(false);
});
