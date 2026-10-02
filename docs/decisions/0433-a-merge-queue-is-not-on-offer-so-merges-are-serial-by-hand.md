---
number: 433
slug: a-merge-queue-is-not-on-offer-so-merges-are-serial-by-hand
status: Accepted
date: 2026-09-03
area: CI / build cadence
summary: "A merge queue was the structural fix for the class of failure the gate's first full battery found on 2026-09-02 — two branches merged minutes apart, each green against the main it had seen, never tested together — and the gate's merge_group tier was wired for it. GitHub offers merge queues only in organization-owned repositories (public, or private on Enterprise Cloud); this repository is private and user-owned, so the setting does not exist for it, and the only routes to it are a transfer to an organization plus either going public or paying for Enterprise Cloud. The owner declined the transfer: it costs time the project does not have, and interleaved-merge failures are dealt with as they come. The merge_group tier stays wired, unreachable, for the day the ownership changes. The stand-in is a habit rather than a ruleset: one merge at a time, the next branch synced onto the main the last merge produced. 'Require branches to be up to date before merging' is deliberately left off because it spends a full battery per open stream per merge, which is the budget pressure the austerity exists to avoid, and it still cannot stop two branches updated from the same main from landing back to back."
---

**A merge queue is not available to this repository, the owner declined the transfer that would make
it available, and merges are serialized by habit rather than by a ruleset.**

**Context:** The gate's first full battery in a month, on 2026-09-02, found a run of red checks with
one shape: two branches merged minutes apart, each green against the `main` it had seen and never
tested together. The pull-request tier cannot see that by construction. A merge queue builds the
exact tree that will land and runs the gate on it, which is the structural fix, and #488 wired the
gate's `merge_group` tier for it (base resolved from the queue's payload, fan-out sinks deferred
while the austerity holds). GitHub offers merge queues in public repositories owned by an
organization and in private repositories owned by organizations on Enterprise Cloud. This repository
is private and owned by a user account, so the **Require merge queue** setting does not exist for it
and no plan change on a user account adds it.

**Decision:** No transfer. The owner's ruling on 2026-09-03 is that moving the repository to an
organization — and then either making it public or paying for Enterprise Cloud, plus re-binding
Workers Builds, the GitHub App installs and the connector access — eats time the project does not
have, and that interleaved-merge failures are dealt with as they come. The `merge_group` tier stays
wired and unreachable, so the tier is ready the day the ownership changes. The stand-in is a habit:
merge one pull request at a time, and sync the next branch onto the `main` the last merge produced
before it lands. The ruleset option _Require branches to be up to date before merging_, which would
enforce that habit, is deliberately left off: with several streams open it forces a full battery per
stream per merge, which is the budget pressure the austerity exists to avoid, and it still cannot
stop two branches updated from the same `main` from landing back to back.

**Consequences:** The pull-request tier is the only run between a merge and production, and the
conventions say so plainly instead of describing a second run that is coming. The interleaving gap
is narrowed by discipline and caught after the fact by the nightly sweep when that tier is restored.
If interleaved-merge failures recur at the 2026-09-02 rate, the decision to revisit is the
up-to-date-before-merge option, priced in runner-minutes against the minutes those fixes cost; the
transfer is revisited only if the ownership question is reopened for other reasons.
