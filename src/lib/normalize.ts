const LEADING_ARTICLES = ['to ', 'the ', 'a ', 'an '];

/**
 * Normalizes an English answer for comparison. Applied to both the learner's
 * input and every accepted answer, so the two are always compared like for like.
 *
 * Parentheticals are stripped before articles, so "(the) government" works
 * whichever way round the learner writes it. Diacritics are left alone.
 */
export function normalize(s: string): string {
  let out = s.replace(/\([^)]*\)/g, ' ');
  out = out.trim().replace(/\s+/g, ' ').toLowerCase();
  out = out.replace(/^["'\u201c\u201d\u2018\u2019]+/, '').replace(/["'\u201c\u201d\u2018\u2019]+$/, '');
  out = out.replace(/[.!?]+$/, '');
  out = out.trim().replace(/\s+/g, ' ');

  for (const article of LEADING_ARTICLES) {
    if (out.startsWith(article)) {
      out = out.slice(article.length);
      break;
    }
  }

  return out.trim();
}

/** Splits an accepted answer on `/` and `,` into its alternates, each normalized. */
export function alternates(answer: string): string[] {
  return answer
    .split(/[/,]/)
    .map(normalize)
    .filter((piece) => piece.length > 0);
}
