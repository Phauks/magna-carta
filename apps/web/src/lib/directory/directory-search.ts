/*
 * What the directory's search can and cannot be asked.
 *
 * The firm's search matches three-character windows of a name, so a query shorter than three
 * characters produces no windows and can match nothing at all. That is a real limit of the record
 * rather than a rule the screen invented, and a screen that sent the query anyway would show an
 * empty result set that reads exactly like "the firm holds nobody by that name".
 *
 * The answer is also CAPPED. A ranked search answers with its best matches, not with all of them,
 * so a caller has to be able to tell a short answer from a complete one — otherwise "no more
 * results" and "we stopped counting" look alike.
 */

/**
 * The shortest query the firm's record can answer. Punctuation and spacing are stripped before the
 * windows are cut, so the count is over the letters and digits a query actually carries.
 */
export const MINIMUM_QUERY_LENGTH = 3;

/** The query as the record will see it: trimmed, with everything that is not a letter or digit gone. */
export function searchableQuery(typed: string): string {
  return typed
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .trim();
}

/** Whether the firm's record can be asked this at all. */
export function isAskableQuery(typed: string): boolean {
  return searchableQuery(typed).length >= MINIMUM_QUERY_LENGTH;
}
