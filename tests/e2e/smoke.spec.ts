import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import entries from '../../src/data/entries.json' with { type: 'json' };

interface Entry {
  swedish: string;
  english: string[];
}

/**
 * The answer is looked up from the deck data rather than read off the back of
 * the card, so the test never depends on having flipped it first — and a card
 * answered without flipping is the path that actually scores points.
 */
const ENGLISH_BY_SWEDISH = new Map(
  (entries as Entry[]).map((entry) => [entry.swedish, entry.english[0] ?? '']),
);

const NAME = 'Testare';

/** The card's label is `"<swedish> — tryck för att vända kortet"`. */
async function currentSwedish(page: Page): Promise<string> {
  const label = await page.getByRole('button', { name: /tryck för att vända kortet/ }).getAttribute('aria-label');
  return (label ?? '').split(' — ')[0] ?? '';
}

async function answerCurrentCard(page: Page, correctly: boolean): Promise<void> {
  const swedish = await currentSwedish(page);
  const english = ENGLISH_BY_SWEDISH.get(swedish);
  expect(english, `no English known for "${swedish}"`).toBeTruthy();

  await page.getByRole('textbox', { name: 'Svara på engelska' }).fill(correctly ? (english ?? '') : 'definitely not the answer');
  await page.getByRole('button', { name: 'Kolla', exact: true }).click();
}

async function completeFirstRun(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Hej! Vem är du?' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Visningsnamn' }).fill(NAME);
  await page.getByRole('button', { name: 'Kör igång' }).click();
  await expect(page.getByRole('heading', { name: 'Välj en lek' })).toBeVisible();
}

test('a learner can set up, play, be scored, and be remembered', async ({ page }) => {
  await completeFirstRun(page);

  // Start a deck.
  await page.getByRole('link', { name: /Alla ord/ }).click();
  await expect(page.getByRole('button', { name: /tryck för att vända kortet/ })).toBeVisible();

  // A correct answer scores and starts the streak.
  const firstSwedish = await currentSwedish(page);
  await answerCurrentCard(page, true);
  await expect(page.getByLabel(/^Svit:/)).toHaveAttribute('aria-label', 'Svit: 1');

  const scoreLabel = await page.getByLabel(/^Poäng:/).getAttribute('aria-label');
  const score = Number((scoreLabel ?? '').replace('Poäng: ', ''));
  expect(score).toBeGreaterThan(0);

  // A correct answer advances itself after a short celebration, so the next
  // card arrives without anything being clicked.
  await expect
    .poll(async () => currentSwedish(page), { timeout: 5000 })
    .not.toBe(firstSwedish);

  // A wrong answer breaks the streak.
  await answerCurrentCard(page, false);
  await expect(page.getByLabel(/^Svit:/)).toHaveAttribute('aria-label', 'Svit: 0');

  // The score survives a reload, which is the whole point of the storage layer.
  await page.reload();
  await expect(page.getByLabel(/^Poäng:/)).toHaveAttribute('aria-label', `Poäng: ${String(score)}`);

  // Starting a different deck banks the run that was in progress, which is what
  // puts it on the board; there is no separate "finish" button to press.
  await page.goto('./#/decks');
  await page.getByRole('link', { name: /Skola och språk/ }).click();
  await expect(page.getByRole('button', { name: /tryck för att vända kortet/ })).toBeVisible();

  await page.goto('./#/leaderboard');
  await expect(page.getByRole('heading', { name: 'Topplista' })).toBeVisible();
  await expect(page.getByText(NAME, { exact: true })).toBeVisible();
});

test('every asset the page asks for resolves under the deployed base path', async ({ page, baseURL }) => {
  // Taken from `baseURL` rather than written out, so if the app ever moves off
  // the apex domain and back under a path, this assertion moves with it.
  const deployed = new URL(baseURL ?? '');

  const missing: string[] = [];
  const offBase: string[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400) missing.push(`${String(response.status())} ${String(url)}`);
    // A 404 alone does not catch a wrong `base`: `vite preview` falls back to
    // index.html for unknown paths, so a build addressed at the wrong prefix can
    // still answer 200 here and only break once it is deployed. The path the
    // asset is asked for at is the assertion that actually catches it.
    if (url.origin === deployed.origin && !url.pathname.startsWith(deployed.pathname)) {
      offBase.push(String(url));
    }
  });

  await completeFirstRun(page);
  // The two lazily fetched screens, so a base-path mistake in a split chunk
  // cannot hide behind a route nobody visited.
  await page.goto('./#/add');
  await expect(page.getByRole('heading', { name: 'Lägg till ord' })).toBeVisible();
  await page.goto('./#/leaderboard');
  await expect(page.getByRole('heading', { name: 'Topplista' })).toBeVisible();

  expect(missing).toEqual([]);
  expect(offBase).toEqual([]);
});
