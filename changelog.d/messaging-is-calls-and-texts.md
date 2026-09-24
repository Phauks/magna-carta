---
category: Changed
audience: internal
---

**The sidebar's Messaging row is calls and texts, and the four things wearing that name are down to
one.** The row had an id meaning the whole three-channel Communications layer (`communications`), a
label meaning one channel (Messaging), and a description meaning two ("Client and portal messages") —
while the matter section wearing the same label described a fourth thing again, the client portal's
`comment`/`message` grant capability. Nothing in the tree agreed, and every future reader of either
registry would have had to guess. The owner settled it on 2026-09-07: **Messaging is voice and
SMS/MMS** — the two channels ADR-0047 already decided and neither of which has a line of code — for
logging what occurs, routed through the carrier so the logging happens by itself, with recording and
transcription over the voice half.

**Email is refused from the row on purpose, and the refusal is argued rather than assumed.** The case
for folding it in is real: captured mail that routes to no matter lands unrouted today —
`apps/api-worker/src/background/emails/capture-consumer.ts` says so outright — and **no screen anywhere in the
product shows those**, so mail is being captured into a place nobody can look at. It loses anyway,
twice. Email already has a home the platform deliberately does not replace: the whole posture is
_file from the mailbox into the matter_ — the add-in's pane, the forward/CC capture address, the
auto-file rules — so a row that opens a mail list competes with the client the member already has
open. And calls and texts have no other home at all; there is no mailbox for the firm's SMS number,
and a phone call leaves no artifact unless the platform makes one. The verbs are different —
_route what exists_ against _cause a record to exist_ — and one row cannot carry both. The unrouted
mail gap survives as an open question rather than being quietly absorbed.

**The design names the log as the durable thing and the carrier as a producer into it**, which is
what takes the surface off the vendor's critical path. One `communication` record — channel,
direction, counterparty, member, nullable matter, instant, duration, body, attachments in per-firm
R2 — written by three producers in the order they can be built: a member logging a call by hand, the
Telnyx adapter writing the same row from a signed webhook, and transcription enriching a row that has
a recording. A2P 10DLC registration is weeks of procurement lead time by ADR-0047's own account and
gates only the second of those, so the record model and both screens are blocked on nothing.

**The global row and the matter section are split by one sentence: the global row holds the
unassigned and the cross-matter, the section holds the assigned and the case-bound.** An inbound text
from an unrecognised number belongs to no matter, which makes filing a conversation onto a matter an
act that exists only globally; inside a matter the reverse act exists (unlink, as filed mail already
has) but routing from scratch does not. The gate is where they actually diverge: a section inherits
the matter's own access, while the global screen must narrow routed rows to matters the member may
see before anything hydrates — the email add-in's suggestion ranking is the precedent to reuse — and
unrouted rows, having no matter, fall through every matter-based gate and need a permission of their
own rather than "any member may read the firm's inbound traffic."

**Recording is sequenced last for a legal reason, not a technical one.** ADR-0047 gates call-recording
consent on the jurisdiction-profile machinery — roughly a dozen states require all-party consent where
Nevada requires one — and that machinery is still in design. Text logging, manual call logging and
carrier call _metadata_ carry no such gate; the audio does.

**And it is built, not only designed.** One per-firm `communication` row behind
`@magna-carta/communications` and seven operations; the firm-wide `/communications` screen and the
matter's Messaging section over ONE listing component, so the section cannot drift from the log it is
a view of; the section off `soon` with a search source, a timeline source and a create noun, which
answers all three coverage lints rather than deferring them; the destination flipped to `shipped` at
`alpha` in the same commit as the screen, per the registry's own rule. The audit log carries
identifiers, enums and instants and never the words or the number, asserted by a test rather than
trusted. 45 tests.

**Building the gate found a real hole in it.** `readRoutableMatter` selected from an unaliased
`matter`, and the visible-matter predicate composes as `EXISTS (SELECT 1 FROM matter WHERE matter.id
= <expression> …)` — so the subquery's table shadowed the outer one, the correlation degenerated to
`matter.id = matter.id`, which is true of every row, and the anchor check silently passed **every
matter in the firm**, the platform-owned custody holding matter included. The outer table is now
aliased `anchor`, and the test that caught it is kept beside the one that proves an unrouted row is
unreachable by id without the capability. Anything else composing this predicate over `matter` itself
is exposed the same way.

Five open questions for the owner remain, including where portal secure messaging now lives and where
the unrouted **email** queue does — the one part of the cross-channel argument that survives the
refusal above, and still the one screen the product does not have.
