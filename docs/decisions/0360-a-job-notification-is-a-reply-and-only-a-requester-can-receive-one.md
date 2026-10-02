---
number: 360
slug: a-job-notification-is-a-reply-and-only-a-requester-can-receive-one
status: Proposed
date: 2026-08-15
area: Notifications
summary: "A job coordinator's terminal state additionally writes a durable notification for the member who asked for the job — the row for the tab that was closed while it ran — and the dedupe key carries the terminal outcome as well as the job, so a job the stuck-alarm failed and that then reported success announces both rather than leaving the timeout's row standing as the last word. It is built for `DocumentAssemblyJob`, the coordinator that records a requester, and deliberately NOT for the other four: `ConversionJob`, `SearchIndexJob`, and `BundleBuildCoordinator` record no requester at all, and `BundleBuildCoordinator` structurally cannot — it is single-flight across concurrent identical requests, so one job has many requesters and naming one would reply to the wrong person. `RecoveryJobCoordinator` does record `startedByUserId` and is registered but unwired, because its five terminal transitions sit on the platform's most sensitive read path and centralizing them is a refactor that belongs in its own change."
---

**Every other audience in this registry is deliberately wide. This one is deliberately narrow, and
the reason is that a job notification is a reply rather than an announcement.**

**Context:** Five job coordinators already broadcast their terminal state over a per-job socket, and
that push is the fast path and stays unchanged. What it cannot do is reach somebody who submitted a
document assembly, closed the tab, and went to a hearing — which is the ordinary case for work
measured in minutes, because watching a ten-minute job would be silly.

**Decision:** A terminal transition additionally writes a `jobs`-category notification, addressed to
the member the coordinator recorded as the requester, through the same registry, the same audience
resolver, the same materializer, and the same UNIQUE-insert statements as every other notification.
The type declares `audience: "actor"` with `includeActor: true`, so "the requester hears it" is a
declared registry fact a fitness test can read rather than a special case buried in the coordinator.

**Three properties shape the implementation.**

**It reaches one person, and that is correct here and nowhere else.** The registry's fitness pass now
asserts that a matter-anchored type does not resolve to a single member unless it appears on a short
list saying why — the failure mode that put three notification kinds in front of exactly one reader
once already. Job completions are on that list, with the reason: nobody else asked.

**The coordinator has no batch to ride, so the write is best-effort and fails quietly.** Its state is
in Durable Object storage, not the firm's database. The write therefore happens _after_ the
transition has been persisted and its failure is caught, counted, and logged: a member whose document
was filed must never be told it failed because the row announcing it could not be written, and a
coordinator must never be left un-transitioned because a notification threw.

**The dedupe key carries the outcome.** A slow-but-successful assembly can be failed by its stuck-job
alarm and then report success, and the coordinator deliberately lets the confirmed result win. Keying
on the job alone would leave the timeout's row standing and tell the member their document failed
while it sits filed on the matter. Keying on `(kind, job, outcome)` means both terminal reports are
recorded — both of them happened — and a redelivery of either is still a no-op.

**What is deliberately not built, and why each.** `ConversionJob` and `SearchIndexJob` record no
requester: they are triggered by ingest and by re-extraction, and nobody is in a tab. Reaching
somebody would mean inventing a recipient. `BundleBuildCoordinator` records none either, and the
absence is structural rather than an omission — it is keyed by `firmId:manifestHash` and is
single-flight by design, so identical concurrent requests share one build and one job genuinely has
several requesters; a single `requestedBy` field would reply to whichever of them arrived first.
Giving it a requester set is a real change to its message shape and its routes and belongs with
whoever next opens that subsystem. `RecoveryJobCoordinator` does record `startedByUserId`, and its
type is registered here so the day it is wired the change is one call — but it reaches a terminal
state from five places on the path that holds a recovered password for exactly one read by exactly
one member, and centralizing those five into one settle point is a refactor of a security-sensitive
coordinator that should not ride in a notifications slice.

**Considered and rejected:** **Writing the row from the queue consumer instead**, where a firm
database is already in hand — the consumer is not where the terminal decision is made, the
coordinator guards the transitions, and the alarm path has no consumer at all. **Carrying the failure
reason in the facts** — the coordinators' reasons are a mixture of codes and sentences, and a slot
that is a code today and a sentence after one refactor is the door the fact grammar exists to close;
the reason is on the job's own status read. **Keying on the job alone and letting the first terminal
report win** — one row per job, and it is the wrong row exactly when the member most needs the right
one.

**Consequences:** A document assembly now leaves a durable trace addressed to whoever asked for it,
filtered by the same wall as everything else because the row is anchored to the matter the document
was filed onto. Four coordinators still announce nothing durable, and each now has a written reason
rather than an unexplained gap.
