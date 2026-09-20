/**
 * Entry ids are slugs, because they end up in exported JSON that a person may
 * well read. `wordEntrySchema` only allows `[a-z0-9-]`, so the Swedish letters
 * are folded rather than stripped: dropping them would turn `få` into `f`.
 */

const FOLDED: Record<string, string> = {
  å: 'a',
  ä: 'a',
  ö: 'o',
  é: 'e',
  è: 'e',
  ü: 'u',
  ø: 'o',
  æ: 'a',
};

export function slug(text: string): string {
  let folded = '';
  for (const char of text.trim().toLowerCase()) {
    folded += FOLDED[char] ?? char;
  }
  return folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * `slug(lemma ?? swedish) + '-' + pos`, with a numeric suffix when that is
 * already spoken for. The suffix is what keeps a learner's `gå` from shadowing
 * the built-in one — a collision adds a card, it never replaces one.
 */
export function entryId(base: string, pos: string, taken: ReadonlySet<string>): string {
  // An entry written entirely in characters the slug drops still needs an id.
  const root = `${slug(base) || 'ord'}-${pos}`;
  if (!taken.has(root)) return root;

  let suffix = 2;
  while (taken.has(`${root}-${suffix}`)) suffix += 1;
  return `${root}-${suffix}`;
}
