---
category: Changed
audience: public
---

**Discovery's attribution reads "Custodian of Record" wherever a person meets it.** The owner named
the label; the code word does not move. Every user-facing string now carries it — the OpenAPI
`description`s on the record-custodian routes, the refusal sentences the discovery services raise
that a route surfaces verbatim as a problem `detail`, and
[`docs/user/features/review-sets-and-loading.md`](../docs/user/features/review-sets-and-loading.md).
Identifiers, tables, columns, route paths (`/api/v1/review-sets/{reviewSetId}/record-custodians`),
schema names, and refusal codes stay `record_custodian` / `recordCustodian`, so nothing on the wire
changes shape. `tooling/lint-custodian-vocabulary.mjs` now recognises both permitted forms and
nothing else: the leading-`record` family for code, the full phrase "Custodian of Record" for
readers, and a bare `custodian` still fails in every casing and position — with self-test rows for
the near-misses ("the custodian of the estate" is still a violation). No screen was touched; the UI
surfaces are the owner's to schedule.

## Public

**The people whose records you are reviewing are called Custodians of Record.** Same idea, clearer
name: when you say whose files a load came from, that is the Custodian of Record. It stays distinct
from the safe custody register, which is about physical originals the firm holds — you will meet
both in one matter, and neither is ever shortened to just "custodian".
