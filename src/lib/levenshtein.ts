/**
 * Standard two-row dynamic programming edit distance. No dependency.
 *
 * The rows are walked with `entries()` rather than indexed directly, so under
 * `noUncheckedIndexedAccess` there are no unreachable `?? 0` fallbacks.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;

  const aChars = Array.from(a);
  const bChars = Array.from(b);
  if (aChars.length === 0) return bChars.length;
  if (bChars.length === 0) return aChars.length;

  let previous = [0, ...bChars.map((_, index) => index + 1)];
  let result = 0;

  for (const [i, aChar] of aChars.entries()) {
    const current: number[] = [];
    let diagonal = 0; // previous[j - 1]
    let left = 0; // current[j - 1]

    for (const [j, above] of previous.entries()) {
      if (j === 0) {
        left = i + 1;
      } else {
        const cost = aChar === bChars[j - 1] ? 0 : 1;
        left = Math.min(above + 1, left + 1, diagonal + cost);
      }
      current.push(left);
      diagonal = above;
    }

    previous = current;
    result = left;
  }

  return result;
}
