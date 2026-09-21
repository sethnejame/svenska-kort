const LEADING_ARTICLES = ['to ', 'the ', 'a ', 'an '];

/** Case, spacing, quotes and parentheticals: what both languages agree on. */
function tidy(s: string): string {
  let out = s.replace(/\([^)]*\)/g, ' ');
  out = out.trim().replace(/\s+/g, ' ').toLowerCase();
  out = out.replace(/^["'\u201c\u201d\u2018\u2019]+/, '').replace(/["'\u201c\u201d\u2018\u2019]+$/, '');
  out = out.replace(/[.!?]+$/, '');
  return out.trim().replace(/\s+/g, ' ');
}

/**
 * Normalizes an English answer for comparison. Applied to both the learner's
 * input and every accepted answer, so the two are always compared like for like.
 *
 * Parentheticals are stripped before articles, so "(the) government" works
 * whichever way round the learner writes it. Diacritics are left alone.
 */
export function normalize(s: string): string {
  let out = tidy(s);

  for (const article of LEADING_ARTICLES) {
    if (out.startsWith(article)) {
      out = out.slice(article.length);
      break;
    }
  }

  return out.trim();
}

/**
 * The same tidy-up for a Swedish answer. No article is stripped: `en` and `ett`
 * carry the gender, and `att` is part of the infinitive, so dropping either
 * would throw away the thing being learnt.
 */
export function normalizeSwedish(s: string): string {
  return tidy(s);
}

/**
 * Flattens the Swedish letters onto keys every keyboard has, so a learner
 * without å, ä and ö to hand can type `aao` and mean `åäö`.
 */
export function foldSwedish(s: string): string {
  return s
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e');
}

/** Splits an accepted answer on `/` and `,` into its alternates, each normalized. */
export function alternates(answer: string): string[] {
  return answer
    .split(/[/,]/)
    .map(normalize)
    .filter((piece) => piece.length > 0);
}
