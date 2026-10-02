---
number: 472
slug: a-health-row-answers-for-its-own-subsystem-not-for-one-field-of-it
status: Accepted
date: 2026-09-16
area: Observability & diagnostics
summary: A diagnostic row reports on its whole subsystem, not on whichever field is cheapest to compare — a row that can read healthy while the thing it describes is broken is worse than no row.
---

A diagnostic row reports on its whole subsystem, not on whichever field is cheapest to compare — a row that can read healthy while the thing it describes is broken is worse than no row.

**What happened.** The Database section's schema row derived its state from `appliedHead === expectedHead`. The firm database's migration read had always returned a fault alongside those tags, and the row ignored it. Because the runner refuses an unrecognised ledger before applying anything, a refused database keeps whatever tags it had — so one sitting at head reported `Schema: Up to date` while the row above it reported the database answering nothing.

**Why that is worse than a missing row.** The section exists to separate causes that a single unhelpful sentence collapses, and its own standard is that a check which could not run says so rather than reporting health. This check ran and reported health about a broken subsystem, which is the failure the standard was written against, arriving through a door it did not cover: not an unanswered question, but an answered one read too narrowly. A reader who trusts the rows has been told the schema is fine and will look somewhere else.

**The rule.** A row's state is derived from every fact its subsystem reports about itself, with the disqualifying ones read first. Where a subsystem reports a fault, no comparison of its other fields can outrank that fault. Concretely: the schema state reads `refused` from the fault before it compares heads, and `refused` is distinct from `unknown` — "could not ask" and "asked, and the runner said no" are different facts, with different next steps.

**Corollary: a fact carried across a boundary is displayed or is not carried.** The same function dropped `outOfOrderArrivals` and `restorePoint`, both computed by the firm database, serialized, and discarded on arrival. A measurement nothing reads is indistinguishable from one never taken, and these two are precisely the facts with no other symptom — an out-of-order arrival is silent by construction, and a restore point is invisible until somebody needs it and cannot find out it exists. They are shown as notes rather than rows, on the existing rule that a line blank on every healthy firm teaches a reader to skip it.

**Scope of what is shown.** Diagnostics answer the reader in front of them. The restore point's Cloudflare bookmark is an operator's handle, useless to the member reading the panel and needlessly specific to put on a session-authenticated wire, so what travels is that a point exists, when it was taken, and what it precedes.
