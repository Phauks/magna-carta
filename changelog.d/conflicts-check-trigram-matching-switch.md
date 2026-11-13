---
category: Added
audience: public
---

**A conflicts check can leave out trigram matching.** Trigram overlap (any shared three-letter piece of a name) is the noisiest of the Directory's matching channels: a candidate found only by it lands at tier 4, and it accounts for most candidates. The scope request takes an optional `trigramMatching` flag. When the flag is false, the balanced band skips the trigram channel. The over-inclusive band always runs it, so it remains a strict superset of balanced. `MatchOptions.trigram` in `packages/directory/src/search.ts` is the one switch, honoured by the per-subject and batched matchers alike, and the matcher-equivalence test covers the off case. The run records the choice as `inputs_json.matching.trigramMatching`. It surfaces on the check read's matching record and on the run's asked scope, and the report says when it was off. Older rows have no key and read as on, since the channel always ran. No migration. The contract gains one optional request field and one response field.

## Public

The New Check panel's Advanced Settings has a **Trigram matching** box, on by default. Clearing it stops the check from finding names that only share a few letters with a party's, which is the noisiest kind of result. Widest always keeps it on. A check run without it says so in its Details and its report.
