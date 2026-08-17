---
number: 356
slug: an-extraction-records-the-engine-that-read-the-document
status: Proposed
date: 2026-08-15
area: Discovery
summary: "Discovery processing gets its own `DISCOVERY_PROCESS` queue lane, and the platform's one text-extraction port becomes genuinely composite: the pure-Rust discovery engine reads natively, recognition is asked only about pages the engine reports as pixels, and the consented office container converts a legacy binary so the memory-safe engine can read the CONVERSION rather than the 1997 bytes. The port's three dispositions are unchanged and gain a separate diagnosis field, because what the pipeline should DO about a failure and what a firm has to be able to SAY about it are two facts — `encrypted` and `unsupportedFormat` are both terminal, and a corpus that could only record `unextractable` could not tell a court which one it was. Every extraction records its ROUTE on the review document, which is the fact that was missing when an OCR-only port recorded born-digital PDFs as unreadable and nothing in the corpus could say why. A document nothing can read is a named exception code a reviewer sees; a document an UNDEPLOYED engine has not read yet parks at `pending` with its reason on the row, because those are different sentences and only one of them is a verdict."
---

**A pipeline that records only its output cannot answer the question a court actually asks: not what
the text says, but how you came to have it.**

**Context.** Discovery 5·1 shipped the corpus and the engine and left the wire between them unbuilt.
The review-set model, the load lanes, the fan-out coordinator, `crates/discovery-core` and its
Container all exist; nothing carried a document from the first to the second. Two things had to land
together, because each is useless alone: a queue lane that reads documents off the request path, and
an extraction port that can actually read the formats a production arrives in.

The port had history. Backed only by the recognition service, it skipped every page that already
carried a text layer — correct for a recognizer, fatal for an extractor — so a born-digital PDF, the
most common document a firm holds, came back with no lines on any page and was recorded as having no
readable text at all. That was closed by making the port read a PDF's own text layer first and send
only the pixel pages on. The defect is instructive beyond the fix: nothing in the resulting corpus
recorded which engine had looked, so the failure was invisible until somebody read the code.

**Decision.**

**The route is recorded, per document, on the row.** `review_document.extraction_route` holds the
engines in the order they ran, from a closed vocabulary — `discovery-engine`,
`discovery-engine,recognition`, `office-conversion,discovery-engine`. Beside it,
`pages_recognized` counts how many pages are a machine's reading of a picture rather than the
author's characters, and the per-page provenance list goes to the metadata sidecar in R2. A search hit
in recognized text is a different kind of evidence from a hit in a text layer, and a reviewer, a
producing party and an opposing party all need to be able to tell them apart. The route is also what
makes a defect like the born-digital one legible from the data rather than from the source.

**Extraction resolves in three native routes and one conversion route, in a fixed order.** The
discovery engine first, when its service is bound: pure Rust, identifies from the bytes rather than
the file name, and returns the page count, the document date and the near-duplicate fingerprint in the
same pass — facts that cost nothing here and a second run over the whole corpus to recover later. The
in-Worker WASM PDF reader when it is not, narrower and kept because a deployment without the engine
still has to read what it can. Recognition only for pages a native route reported as pixels, never for
a page that already had words. And the consented, network-isolated office container for a legacy
binary — which is a route to a reading rather than a reading: the conversion's output goes back
through the memory-safe engine, so the parser that touches an opposing party's bytes stays pure Rust
even for a format no pure-Rust parser exists for. The identified format on the row stays the LEGACY
one, because the corpus must record what arrived and not what the platform turned it into on the way.

**A disposition and a diagnosis are separate fields.** `TextExtractionFailureReason` keeps its three
values — park, terminal, retry — because the pipeline does exactly three things. A new optional `code`
carries the engine's own stable string. The search consumer ignores it; discovery maps it to one of
the closed exception codes, and that map is total over the port's vocabulary and proved so against the
port's own export rather than a copy of it. A refusal code the router does NOT recognize is treated as
transient rather than filed under the nearest named code: an unnamed reason means the engine and the
worker are at different versions, which is a deployment fact, and inventing a sentence for an
exception report nobody checked is worse than retrying.

**A document an undeployed engine has not read is `pending` with a reason, not `excepted`.** The two
terminal states stay two, and neither of them is "we have not got to it". `processing_deferred_reason`
carries why, so what a review set is still owed is one indexed read over the corpus rather than a
question only a dead-letter queue can answer. This is the `deferred` posture the index pipeline
already takes, expressed where discovery can see it.

**The lane is its own.** `DISCOVERY_PROCESS` with its own dead-letter queue at concurrency 4, apart
from every ingest lane, because a load at the ceiling is a quarter of a million documents and the
alternative is a firm's interactive uploads queued behind an opposing party's production. Dispatch is
a keyset-paged walk from the load coordinator with its cursor in durable storage, and it starts only
once allocation is complete — a dispatch overlapping allocation would queue a corpus that was still
growing, and the reconciliation the load completes against would be counted against a moving number.

**Consequences.** The conversion registry gains `doc`, `xls` and `ppt` as sources and `xlsx`/`pptx` as
targets, with LibreOffice edges to the modern package and onward to PDF. That makes legacy office
files convertible in the file-converter tool as well, which is a real capability a firm wants and no
new dependency: the office container is already consented and already contained. Every one of those
edges parks until that container is deployed.

Two derived objects per processed document — the text and the metadata sidecar — with their own
object classes, both collectable when a review set closes because both are rebuildable from source.

**Alternatives rejected.** *Folding the diagnosis into the disposition* means one union carrying both
"retry this" and "it was encrypted", which every caller then has to destructure the same way and which
the search consumer has no use for. *Inferring the route from per-page provenance* is wrong in both
directions: a page read `native` says nothing about which engine read it, and a converted document has
an engine in its route that no page provenance mentions. *Recording an undeployed engine as an
exception* would say the platform tried and the document could not be read, which is untrue and, worse,
would put a number in an exception report a firm hands to opposing counsel that a later deploy silently
changes. *Reading legacy binaries with a memory-unsafe parser in the engine* is the one thing the
discovery core was built to avoid; converting first costs a hop and keeps every byte an opposing party
chose inside a pure-Rust reader.
