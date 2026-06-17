/**
 * Normalize a raw name string to a stable search/phonetic key.
 *
 * FROZEN CONTRACT — do not change the transform without coordinating a full
 * phonetic-code and search-index rebuild across every firm's data. The output
 * of this function is stored in directory_name.normalized_name and drives
 * fuzzy search, duplicate detection, and phonetic encoding; changing it
 * silently produces stale index rows that will never match incoming queries
 * until every firm is re-indexed. Treat any modification like a database
 * migration: plan the re-index sweep before merging.
 *
 * Transform steps (applied in order):
 *   1. NFC normalize — compose combining characters so diacritic stripping
 *      is consistent regardless of the Unicode form the caller supplies.
 *   2. NFD + diacritic strip — decompose then remove Diacritic-category
 *      code points (e.g. é → e, ö → o).
 *   3. Lowercase.
 *   4. Apostrophes/quotes removed — elision marks (', `, ') are dropped
 *      rather than replaced with a space so that O'Brien → obrien (a single
 *      token), consistent with how names are spoken and searched.
 *   5. Remaining punctuation → space — any other non-alphanumeric,
 *      non-whitespace character becomes a space so Smith-Jones → smith jones.
 *   6. Collapse whitespace and trim.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFC")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['‘’`]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
