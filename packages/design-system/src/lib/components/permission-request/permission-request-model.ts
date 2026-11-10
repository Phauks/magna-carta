/*
 * The words the permission request supplies itself, so that every request in the product reads the
 * same way whichever feature raised it.
 */

/** The commit's verb. One word for every request: what the reader does to a permission is allow it. */
export const ALLOW_LABEL = "Allow";

/** The same verb while the grant is in flight. */
export const ALLOWING_LABEL = "Allowing";

/** The line naming who is asking, as the panel's subject line states it. */
export function askedByLine(askedBy: string): string {
  return `Asked by ${askedBy}`;
}
