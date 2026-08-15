---
category: Added
audience: internal
---

**Discovery reads its corpus. The `DISCOVERY_PROCESS` queue lane carries a review document from the
review set to the pure-Rust engine, and the platform's one text-extraction port becomes genuinely
composite — recording which engine read each document, which is the fact the corpus could not
previously state.**

**The lane.** A dedicated queue with its own dead-letter queue at concurrency 4, separate from every
ingest lane, because a load at the ceiling is a quarter of a million documents and the alternative is
a firm's interactive uploads queued behind an opposing party's production. Dispatch is a keyset-paged
walk from the load coordinator with its cursor in durable storage, so an eviction or a deploy costs a
repeated page and never a skipped document; it starts only once allocation is complete, so the
reconciliation the load completes against is never counted against a growing corpus. Messages carry
identifiers and R2 keys — never bytes, never text, never a file name somebody wrote a client's name
into.

**The composite port.** The discovery engine (`crates/discovery-core` behind `containers/discovery`)
is the native route when its service is bound: PDF text layers, OOXML, OpenDocument, RTF, email and
plain text, all pure Rust, identified from the bytes rather than from a file name, with the page
count, the document date and the near-duplicate fingerprint produced in the same pass. Recognition is
asked only about the pages the engine reports as pixels. A legacy `.doc`, `.xls` or `.ppt` goes
through the consented, network-isolated office container and the CONVERSION is then read by the
memory-safe engine — so the parser that touches an opposing party's bytes stays pure Rust even for a
format no pure-Rust parser exists for, and the identified format on the record stays the legacy one.
When the engine service is absent the port falls back to the in-Worker PDF reader plus recognition,
exactly as before.

**The route is on the row.** `review_document.extraction_route` names the engines in the order they
ran; `pages_recognized` counts how many pages are a machine's reading of a picture rather than the
author's characters; the per-page provenance list goes to the metadata sidecar in R2. This is the
fact that was missing when an OCR-only port recorded born-digital PDFs as unreadable and nothing in
the corpus could say why.

**A failure is a verdict a reviewer can see.** Every extraction failure maps onto one of the closed
exception codes — `encrypted`, `password-protected`, `corrupt`, `unsupported-format`, `oversize`,
`container-guard-tripped`, `no-text-extracted`, `recognition-failed`, `conversion-failed`,
`container-not-expanded`, `malware-flagged`, `source-bytes-missing` — with the identified format
recorded beside it, because "we could not read this, and it was an encrypted Word document" is a
sentence a firm can say to a court and "extraction failed" is not. The map is total over the
extraction port's own exported vocabulary, proved against that export rather than a copy. A document
that yields no text is excepted rather than indexed empty: an empty index entry asserts "this
document contains no text", the one answer a discovery search must never give wrongly.

**An undeployed engine is a state, not a verdict.** A document nothing has read yet stays `pending`
with `processing_deferred_reason` on the row, so what a review set is still owed is one indexed read
over the corpus rather than a question only a dead-letter queue can answer. Its load will not reach
`complete` while it is outstanding, which is the reconciliation doing its job.

**Also.** The conversion registry gains `doc`, `xls` and `ppt` as sources and `xlsx`/`pptx` as
targets with LibreOffice edges onward to PDF, which makes legacy office files convertible in the file
converter too — no new dependency; the office container is already consented and already contained.
Two new object classes (`review-extracted-text`, `review-document-metadata`) for the derived objects,
both collectable when a review set closes because both are rebuildable from source.

**Not in this change, and separately planned:** deduplication and occurrence rows, container families,
the load manifest and the exception-report artifacts, and the review-document index enqueue.

**Deploy:** the queue pair and the discovery engine worker are recorded in `docs/deploy-queue.md`, in
the order they must happen.
