---
category: Added
---

Magnus — the conversational assistant backend, build slice 1. The record a firm member's
conversation with the assistant becomes, the consent gates that must be opened before a byte of it
leaves the platform, the path from a submitted message to an answer, the transport that returns it,
and the audit and cost record it leaves behind. **No user interface, and nothing reaches a model
provider**: both firm-level consent settings default closed and the shipped adapter is a
deterministic stub. This builds the thing that is later switched on; it does not switch it on.

**The seam is reused, not rebuilt.** The assistant gets no model port of its own. It consumes the
shipped `InferencePort`, whose confidentiality controls — caching off, logging off, firm metadata
derived server-side, a fail-closed eligibility guard before dispatch — are four literal fields on one
object in one function. Their strength comes entirely from there being exactly one place they are set,
so the assistant adds one operation to that port (`generateConversation`) rather than a second port,
and a source scan now enforces that no module outside the inference package can reach the model
binding or construct a gateway options object at all.

**A conversation is the firm's work product, not a session.** Protected, deletable, archivable:
transcripts live in the firm's own database under the firm-scoped data-access layer, visible to their
author and to administrators holding a named permission, never to a client, deletable by their author
with the deletion audited — and registered in the erasure registry, with conversation-level deletion
named as the instrument for the free text inside a message, which no column-level rule can reach. They
are discoverable in the way email is, which is why a firm must be able to say whether transcripts are
in scope when something searches across its records rather than having them swept in silently; that
include-or-exclude control belongs to the discovery surface and lands with it. There is deliberately
no per-conversation off-the-record mode: the question "why was that one off the record" is worse than
any answer. The
Durable Object behind the live-updating transport stores **nothing** — it reads a turn's state back
from the firm's database and pushes it — so exactly one copy of a transcript exists.

**A member cannot occupy the system role.** The platform-authored instruction travels on its own
field, structurally separate from the conversation, and the role vocabulary is the platform's
(`member` / `assistant`) with no system member to be mapped onto.

**Nothing about a conversation is ever logged** — not into the diagnostics pipeline, not into audit
metadata, not into a problem detail, not into a queue payload. The audit builders are structurally
content-free: every input is identifiers, numbers, and closed labels, so logging what somebody typed
would take changing a type signature. Gateway Guardrails are prohibited on this gateway (they log
prompts and responses), and gateway log collection stays off — which means the gateway dashboard shows
nothing for this traffic by design, and the authoritative spend record is the in-repo one.

Also here: a per-firm daily message allowance with a real, finite default, checked before anything is
enqueued; per-message size caps that are what keep a transcript a database row rather than an object
store; a bounded request window (at most twenty messages and 128 KiB, always ending on the newest
question) that tells the member when earlier messages did not fit; two new permissions seeded to the
seats that do legal work, with reading every member's conversation kept as a separate grant; and a
general-purpose deterministic `InferencePort` stub in the inference package that every future AI
feature inherits.
