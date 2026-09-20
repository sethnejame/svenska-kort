export interface DiffSegment {
  text: string;
  marked: boolean;
}

export interface CharDiff {
  typed: DiffSegment[];
  answer: DiffSegment[];
}

/**
 * Splits two strings into a shared head, a differing middle and a shared tail.
 *
 * A full edit-distance backtrace would mark the same characters for the typos
 * this app actually produces, so the cheaper common-prefix/suffix trim is what
 * is here: `decresed` vs `decreased` marks nothing on the left and just the
 * missing `a` on the right, which is exactly what the learner needs to see.
 */
export function diffChars(typed: string, answer: string): CharDiff {
  const a = Array.from(typed);
  const b = Array.from(answer);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return { typed: segments(a, prefix, suffix), answer: segments(b, prefix, suffix) };
}

function segments(chars: readonly string[], prefix: number, suffix: number): DiffSegment[] {
  const parts = [
    { text: chars.slice(0, prefix).join(''), marked: false },
    { text: chars.slice(prefix, chars.length - suffix).join(''), marked: true },
    { text: chars.slice(chars.length - suffix).join(''), marked: false },
  ];
  return parts.filter((part) => part.text.length > 0);
}
