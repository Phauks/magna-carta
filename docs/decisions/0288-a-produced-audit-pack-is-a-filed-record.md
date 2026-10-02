---
number: 288
slug: a-produced-audit-pack-is-a-filed-record
status: Proposed
date: 2026-08-13
area: Reports
summary: "Producing a bar-audit pack is asynchronous and leaves a permanent record: a POST validates and writes one append-only report_production row plus an outbox message in a single batch, a queue consumer assembles the pack, renders it through the assembly-to-PDF conversion edge that already exists, files it as a File Manager version — which computes and stores the SHA-256 content hash at write — and writes an append-only completion row. Completion is DERIVED from the presence of that row rather than from a status column, the same arrangement that keeps a status column off trust_hold and off invoice_application. Filing the artifact is what makes the surface capable of producing evidence at all: the reproducibility contract covers figures for a stated period and knowledge instant, while display names, office letterhead and jurisdiction citations are mutable captions, so the only way to retrieve the exact document a specific examiner was handed is to have kept it. The pack is bounded to one trust account and one period; heavy assembly is off the request path per golden rule 10, and a read route whose period would exceed the measured budget refuses by name and points at production rather than degrading. Whether a produced pack is undeletable and inherits the jurisdiction profile's trust-record retention, and whether it carries its own named attestation the way a closed reconciliation carries closed_by, are open owner questions recorded in the design rather than answered here."
---

**A pack handed to a regulator is kept, hashed, and reproducible as a document even where the
figures' captions are not.**

**Context:** The bitemporal contract makes a pack's amounts reproduce for a stated period and
knowledge instant. It deliberately does not cover captions — a client renamed, two entities merged,
an office's letterhead edited, a jurisdiction citation revised in the corpus. Those are all mutable,
and making them reproduce would mean holding a versioned copy of the directory inside the reporting
layer. So there is exactly one way to retrieve the document a particular examiner was actually
handed: keep it.

There is a second reason. Assembling a pack over a year of a busy trust account is not request-path
work, and golden rule 10 forbids putting it there.

**Decision:** Production is asynchronous and append-only at both ends.

`POST /api/v1/reports/productions` validates the request and writes, in one batch, a
`report_production` row (requester, the temporal triple, the scope) and one outbox message. A queue
consumer assembles the pack from the reads, renders it through the assembly-to-PDF conversion edge
the document-automation tail already landed, files it as a File Manager version — which computes and
stores the SHA-256 content hash at write — and writes a `report_production_completion` row naming the
version, the hash, and the instant, or the refusal it hit. Both tables carry RAISE(ABORT) triggers.
The consumer is idempotent on the outbox row id, like every other consumer.

**Completion is derived from the presence of the completion row**, not from a status column on the
production — the arrangement that keeps a status column off `trust_hold` and off
`invoice_application`, for the same reason: a status column is a second place the truth lives.

The cover of the produced artifact snapshots the captions as they stood — office identity,
jurisdiction citation and its corpus review state, the report's temporal triple, the production id —
and carries, in plain words a reader outside this repository can follow, the statement of what
reproduces and what does not.

Read routes stay for bounded scopes: one account, one period, JSON. A request whose period would
exceed the measured budget refuses by name and points at production rather than degrading into a
timeout.

**Considered and rejected:** **Render synchronously in the request** — simplest, and it puts an
unbounded assembly on the hot path against golden rule 10, with the failure arriving as a timeout in
front of a person who is being audited. **Produce without filing** — cheaper, and it makes "send the
examiner the same document again" a re-render whose captions may have moved, which is precisely the
gap filing exists to close. **A status column on the production row** — one column, and it becomes a
second answer to "did this finish", which the rest of the financial core has repeatedly declined to
create. **Store the assembled figures as structured rows so the pack can be re-rendered rather than
re-read** — that is materialisation, refused elsewhere in this slice; the artifact is a document,
not a source of truth anything reads back.

**Consequences:** A firm accumulates a permanent, hashed record of every pack it produced and who
asked for it, which is itself the kind of thing an examiner finds reassuring. Two questions stay open
for the owner and are recorded in the design: whether a produced pack is undeletable and inherits the
jurisdiction profile's trust-record retention period, and whether it carries its own named attestation
the way a closed reconciliation carries `closed_by` and `closed_at`, or is an unsigned extract of
records that were already attested.
