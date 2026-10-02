---
number: 343
slug: a-note-never-reaches-a-merge-field-or-a-review-set
status: Accepted — built
date: 2026-08-15
area: Notes and activity
summary: "Two containment rules, stated as rules because both failures would look reasonable to whoever wrote them. No merge field ever resolves to a note or a comment on any record — the document-scrub engine removes document-level PDF surfaces and is structurally blind to merge-filled text, which is page content, so a catalog entry resolving to a note body would put internal work product into the body of a letter assembled under the firm's letterhead and the one machine built to stop privileged text escaping in a PDF would not see it; the guard is a source-scan fitness function over the merge-field catalog, landing in the same slice as the note table. And notes stay outside the discovery collection vocabulary — review_document.source_kind is a three-value CHECK over file versions, email messages and email attachments, so a note is structurally uncollectable today, and that default is defended rather than inherited: widening the enum would put every candid internal assessment one bulk load away from a production set with only a process-level quality gate between them, so a note genuinely ordered produced is exported as a document into the matter's file record and collected as that document, which gives it a version, a hash and a custodian of record and makes production a deliberate attributable act."
---

**A note leaves the firm two ways nobody would notice, and both are closed here rather than left to
judgement.**

**Context:** the instinctive question about a privileged note is what the metadata scrub does with it.
The answer is nothing, and the useful finding is the inverse.

The whole-document scrub in `crates/pdf-core` removes **document-level surfaces from a PDF** — the
Info dictionary and XMP metadata, embedded files and file-attachment annotations, XFA datasets,
AcroForm field values, the tagged-structure tree, bookmark titles, optional-content groups — behind a
verification gate that decompresses and scans so a redacted string cannot survive anywhere in the
output. It operates on bytes. It reaches nothing in the per-firm database, and a note stored as a row
neither needs nor gets its attention.

**The exposure runs the other way.** Document automation assembles documents from matter data through
the merge-field catalog. A merge field resolving to a note body would put an internal, privileged,
work-product note into the body of a letter assembled under the firm's letterhead and sent to an
opposing party — and the scrub would not catch it, because merge-filled text is **page content**, not
document metadata. The one machine in this platform built to stop privileged text escaping inside a
PDF is structurally blind to this route.

**Decision one: no merge field ever resolves to a note or a comment, on any record.** Not the body,
not a count, not a concatenation, and not the documents a note points at. It is a rule rather than a judgement call
because the merge-field catalog is a data table that grows by entries, and the entry that does this
will look entirely reasonable to whoever adds it — "the matter's latest note" is a plausible thing for
a template author to ask for. The guard is a **source-scan fitness function over the catalog**, in the
spirit of the calendar's source-fitness pass, and it lands in the same slice as the note table rather
than after it.

**Decision two: notes stay outside the discovery collection vocabulary.**
`review_document.source_kind` is a three-value CHECK constraint over file versions, email messages and
email attachments. A note is structurally uncollectable into a review set today, and nothing in the
discovery package can reach one.

That default is correct and is defended here rather than merely inherited. A firm's internal notes are
its own work product; they are not the client's documents and they are not what a request for
production asks for. A collection vocabulary that could sweep them in would put every candid internal
assessment one bulk load away from a production set, with the review workflow's quality gate as the
only thing between them — and a quality gate is a process control, not a structural one.

**When a note is genuinely ordered produced, the route is to export it as a document into the matter's
file record and collect that document.** It then has a file version, an integrity hash, a custodian of
record, and every other property the review pipeline is built on, and production becomes a
deliberate, attributable, single act rather than a widened enum. Widening `source_kind` is the change
that must not be made quietly, so it is written down here as the thing to refuse.

**Considered and rejected:** **allowing a merge field with a permission gate on it** — the permission
is held by the person assembling the letter, who already has it, so the gate stops nobody. **Relying
on the scrub** — it cannot see page content, and believing otherwise is the specific misconception
this decision exists to correct. **Adding notes to `source_kind` behind a review-set setting** — the
setting would be on by the second matter, and the enum is very hard to shrink again. **Leaving both to
reviewer judgement** — the merge-field case in particular fails silently and is discovered by the
recipient.

**Consequences:** the merge-field catalog acquires a permanent constraint and a test that enforces it,
which costs one fitness function and closes the highest-consequence leak in the note design. Discovery
acquires no change at all, which is the point. Both rules are stated in the note design's spec so the
reasoning travels with them, and the second is additionally raised as an open owner flag, because a
firm under a broad preservation obligation may need its notes inside the same hold-and-collect
machinery as everything else — and a firm that has to export them one at a time may simply stop
writing them.
