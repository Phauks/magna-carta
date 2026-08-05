---
number: 221
slug: custody-labels-and-reminder-emission
status: Accepted
date: 2026-08-04
area: Custodian
summary: "Custody labels are rendered IN-HOUSE as Code 128 barcodes on an SVG label sheet, and the barcode carries the object's IDENTIFIER HANDLE rather than its custody number — a number is a string a firm can re-render, and a scan must resolve through no lookup rule that can change under labels already stuck to boxes in a safe. QR is deliberately not shipped: a linear symbology is a published table plus a modulo-103 checksum, while a QR encoder is Reed-Solomon over GF(256) plus mask evaluation for capacity a one-handle label does not need. Separately, custody REMINDERS resolve through ONE collection point that serves both review dates and overdue check-outs, and it is a QUERY, not a scheduler: no cron entry, no queue, no per-firm timer. The register's reports read it today; when the Notifications registry lands, delivery subscribes to that same function rather than growing a second definition of what is due."
---

**Custody labels are rendered in-house as Code 128 on an SVG sheet, carrying the identifier handle; custody reminders resolve through one query-shaped emission point serving both review dates and overdue check-outs.**

**Context:** The Custodian design named labels and barcodes as a print surface over the register's own reads, and named the reminder emission point as a seam to be defined before the Notifications registry exists. Neither had a settled shape. Both are the kind of decision that is cheap now and expensive later — a label is a physical object that outlives every software change made after it was printed, and a reminder definition that gets written twice is a reminder definition that will disagree with itself.

**Decision:** (1) **Labels are rendered here, as SVG, with no dependency.** A barcode symbology is a fixed published table plus a checksum, so the implementation is smaller than the audit of a package that does it; the platform builds in memory-safe languages by default and a barcode library's transitive graph is exactly where a native canvas quietly arrives; and this runs in a Worker, where the output has to be vector geometry rather than a bitmap in any case. SVG rather than PDF because a sheet is one sheet and needs no pagination engine.

(2) **The barcode carries the object's identifier handle, not its custody number.** A person reads the number; a scanner resolves the object, and those want different things. A custody number is firm-defined and re-renderable — a firm changes its prefix, migrates a paper deeds register, or carries in a number from a prior system — while the handle is the row. Encoding the number would mean a scan resolves through a lookup rule that can change under labels already applied to boxes in a safe, and re-labelling a safe is the one cost a physical register cannot absorb.

(3) **Only linear Code 128 ships, subset B.** It covers all of printable ASCII, every records-room scanner reads it, and its correctness is checkable by the symbology's own structural invariant (every character eleven modules wide with even bar parity), which is what the test asserts. QR waits for scan-to-locate to have a concrete reason to want it: a much larger encoder for capacity a label carrying one handle does not need.

(4) **One sheet per request.** A selection that would run past the end of the sheet is refused rather than paginated. A label that fell onto a second page which printed somewhere else is how a label ends up on the wrong box.

(5) **Reminders have exactly one collection point, and it is a query.** Review dates and overdue check-outs resolve through the same function, in the same shape, with the same coarse age buckets. There is no cron entry, no queue, no per-firm timer, and no delivery in the domain package. The register's reports read it directly, which is a legitimate answer today for a subsystem whose events are measured in years; when the Notifications registry lands, delivery subscribes to that function. The alternative — building a scheduler now — would mean the notifications layer later inherits a second, older definition of what is due.

(6) **A reminder identifies the object and says why it surfaced, and nothing else.** No owner, no borrower, no item description, no location name. The register is a list of the most sensitive things a firm holds and its metadata alone is a disclosure.
