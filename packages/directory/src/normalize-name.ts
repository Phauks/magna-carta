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
 *   4. Apostrophes/quotes removed — elision marks are dropped rather than
 *      replaced with a space so that O’Brien → obrien (a single token),
 *      consistent with how names are spoken and searched.
 *      The set is exhaustive-by-enumeration (curated, not a Unicode category):
 *        U+0027  APOSTROPHE              ‘ (ASCII/keyboard)
 *        U+2019  RIGHT SINGLE QUOT. MARK ‘ (curly/smart quote — Word default)
 *        U+2018  LEFT SINGLE QUOT. MARK  ‘ (curly open quote)
 *        U+0060  GRAVE ACCENT            ` (backtick)
 *        U+02BC  MODIFIER LETTER APOSTROPHE ʼ (Word/legal-system O’Brien)
 *        U+2032  PRIME                   ′ (OCR’d documents)
 *      Adding a codepoint here is a reindex-triggering change — coordinate
 *      a full phonetic-code and search-index rebuild before merging.
 *   5. Remaining punctuation → space — any other non-alphanumeric,
 *      non-whitespace character becomes a space so Smith-Jones → smith jones.
 *   6. Collapse whitespace and trim.
 */
export function normalizeName(raw: string): string {
  return (
    raw
      .normalize("NFC")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      // Apostrophe/elision-mark strip — curated exhaustive set; see step 4 above.
      // U+0027 ‘ · U+2019 ‘ · U+2018 ‘ · U+0060 ` · U+02BC ʼ · U+2032 ′
      .replace(/[\u0027\u2019\u2018\u0060\u02BC\u2032]/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}
