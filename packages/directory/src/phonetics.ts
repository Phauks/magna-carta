// One-file seam over the `double-metaphone` package.
// All imports of `double-metaphone` in this package must live here; no other
// source file may import it directly (enforced by the seam-boundary fitness test).
import { doubleMetaphone } from "double-metaphone";
import type { PhoneticScheme } from "./types.js";

// `doubleMetaphone(value)` returns a 2-tuple [primary, secondary] of strings.
// Both codes are always stored, even when primary === secondary, because the
// blocking/search layer applies each scheme row independently and deduplication
// at storage time would silently discard a valid secondary match.
//
// Input normalization: `double-metaphone` is case-insensitive and handles raw
// name strings correctly. This function does NOT normalize the input (e.g. strip
// diacritics or lowercase); callers that want normalization-consistent codes must
// pass already-normalized text (e.g. the output of `normalizeName`).

export function phoneticCodes(name: string): Array<{ scheme: PhoneticScheme; code: string }> {
  const [primary, secondary] = doubleMetaphone(name);
  return [
    { scheme: "double_metaphone_primary" satisfies PhoneticScheme, code: primary },
    { scheme: "double_metaphone_secondary" satisfies PhoneticScheme, code: secondary },
  ];
}
