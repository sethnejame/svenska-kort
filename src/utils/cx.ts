/**
 * Joins class names, dropping anything falsy.
 *
 * CSS module lookups are `string | undefined` under `noUncheckedIndexedAccess`,
 * so this is what keeps `undefined` out of rendered class attributes.
 */
export function cx(...parts: (string | undefined | false | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}
