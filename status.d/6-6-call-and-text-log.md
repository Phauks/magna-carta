---
slice: 6·6 — Messaging settled as calls and texts: the call and text log, the firm-wide queue of what nobody has filed, and the matter's own section
group: phase-6
order: 6
research: n/a
spec: done
plan: n/a
built: done
ui: done
load-profile: todo
tested: done
branch: claude/messaging-sidebar-ui-setup-6xs8ah
active-work:
next: the messaging port and the Telnyx adapter, gated on A2P 10DLC registration, which is the long procurement pole; the telephony port for call metadata; recording, behind the jurisdiction consent gate; transcription on Workers AI; resolving an inbound number against the Directory; a Directory contact's own cross-channel communications tab, which is where email, calls and texts actually converge; a load-profile volume for the firm-wide read
link-spec: docs/specs/2026-09-07-call-and-text-log-design.md
link-plan:
adrs:
blocked-by:
---

The sidebar's Messaging row had four different meanings attached to it — an id naming the whole three-channel Communications layer, a label naming one channel, a description naming two, and a matter section under the same word describing the client portal's message grant. The owner settled it on 2026-09-07: **Messaging is calls and texts**, for logging what occurs, with the carrier writing the same rows once the firm's number is connected, and recording and transcription over the voice half. Email is refused from the row deliberately — mail lives in the firm's own mailbox and is _filed_ onto a matter from there, so its verb is route-what-exists where the verb here is cause-a-record-to-exist — and the argument is recorded rather than assumed, along with the gap it leaves: captured mail that routes to no matter still has no screen anywhere in the product.

The log is the durable thing and the carrier is a producer of rows into it, which is what takes the whole surface off the vendor's critical path: A2P 10DLC registration is weeks of procurement and gates only the second of three producers. One per-firm `communication` row — channel, direction, counterparty number and its nullable Directory handle, the member on the firm's end, the instant it happened, duration, body, summary, `producer` and the carrier's own reference — behind `@magna-carta/communications` (types, validation, statements, service) and seven operations in `apps/api-worker/src/routes/communications/communications.ts`. The insert writes the literal `'member'` rather than taking the producer as a parameter, because a shared insert taking it as an argument is how a member row eventually gets written claiming to be a carrier one. Three closed vocabularies are CHECKs on the schema, not only types, and so are the channel/content coherence rules: a body belongs to a text, a duration to a call.

**The anchor is a matter with a status, not a matter with a number** — the owner's second ruling the same day, and the one that shaped every read. `matter.matter_number` is null until a matter opens, and an intake or a consultation is where a first contact actually lands, so `assertRoutable` turns on the status and `ROUTABLE_STATUSES` admits intake, consultation, open and hold; a closed matter is refused a new filing while keeping everything already on it. The web picker walks three streams rather than the docket's two, because `listEveryMatter` deliberately excludes intakes — right for a docket, wrong for the surface that files phone calls.

**The unrouted queue takes its own capability, and the reason is structural.** Every filed row is narrowed by the visible-matter predicate, so a walled matter contributes nothing to the firm-wide read; a row with no matter fails that `EXISTS` entirely, which means the predicate silently decides the queue is invisible and the next reader would be tempted to drop it to reach the rows. So the null branch is its own clause the caller asks for by flag, and the route passes it only for `communications:reviewUnrouted` (seeded to Owner/Admin and Paralegal). Filing is gated by the same key, since it reads a queued row on its way; asking for the queue without it is a 403, browsing without it simply omits those rows. Building this caught a real defect in the gate itself: `readRoutableMatter` selected from an unaliased `matter`, so the predicate's own `EXISTS (SELECT 1 FROM matter …)` shadowed the outer table and the correlation degenerated to `matter.id = matter.id` — true of every row, so the anchor check passed every matter in the firm. The outer table is aliased `anchor` and the test that found it is kept.

Two screens over one listing component: the firm-wide `/communications` with the queue as a scope of the same log (never a second table), and the matter's Messaging section, the same read pre-filtered with the matter column dropped. Filing exists only on the firm-wide surface — inside a matter the decision is already made — and unfiling returns a row to the queue rather than deleting it. The section flips off `soon` with its search source, its timeline source and a create noun, so all three coverage lints are answered rather than deferred; the destination flips to `shipped` at `alpha` in the same commit as the screen, per the registry's own rule. The audit log carries identifiers, enums and instants and never the words or the number, asserted by a test rather than trusted. 45 tests: 33 in the package, 12 over the routes.

Recording is sequenced last for a legal reason rather than a technical one — call-recording consent is gated on the jurisdiction-profile machinery, which is itself still in design — and the screen says plainly, once and at the top, that nothing is sent or received yet.
