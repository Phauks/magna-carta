---
category: Added
---

Discovery — ingest and processing — design. The specification for the first built slice of
e-discovery, over a large amount of machinery that already shipped switched off: the search index
format, the write pipeline, text recognition, email parsing, PDF reading, and evidence-grade hashing
were all waiting for something that did not exist.

**What was missing was not an engine — it was the corpus.** Nothing in the platform said "these are
the documents under review in this matter, this is where each one came from, this is whose records
they were, and this is what happened when we processed them." Every discovery feature still to come —
filtering, tagging, threading, near-duplicate detection, the privilege log, producing documents to the
other side — is a function over that one object. This design builds it: a **review set** that
documents and email are **loaded** into, one recorded load at a time, each load carrying a manifest of
what arrived, from whom, on whose authority, and with what hashes.

**Whose files these were is recorded, and the word for it is chosen carefully.** The platform already
has a Custodian register — the firm's safekeeping of physical originals — and discovery's "custodian"
means something completely different. Rather than let one word mean two things in the same matter,
discovery says **record custodian**, in two words, everywhere: it reads naturally to a litigator and
cannot be mistaken for the safekeeping register on screen or in the code.

**Nothing is dropped quietly, and nothing is deduplicated away.** Every document ends in one of
exactly two states — processed, or excepted with a named reason — and a load only completes when the
counts reconcile. Encrypted, corrupt, unsupported, and unreadable documents appear by name in an
exception report the firm can hand to opposing counsel; "we produced everything we could read" becomes
a document rather than an assertion. Duplicate copies are grouped so the expensive work happens once,
but the duplicate is kept and stays attributed to the custodian it came from, because "which
custodians held this document" is a question asked under oath and "we deleted that" is not an answer.

**Files from the other side are treated as hostile, because they are.** Every externally loaded byte
crosses the same gate the platform already uses — real-format checking, hashing, malware scanning,
quarantine as a status rather than a deletion, because an infected file in discovery is evidence.
Archives received in a production are opened, which they previously never were, under hard limits on
nesting, size, expansion ratio, and entry count that are checked before anything is decompressed. A
new document-reading engine is written entirely in Rust, compiled once for the server and once for the
desktop so both produce identical results, and the design introduces no new memory-unsafe dependency.

**Scale is stated in numbers instead of adjectives.** A small production is 10,000 documents; a
moderate matter is several hundred thousand — orders of magnitude beyond everything else the platform
stores, and the only data whose volume is set by an outside party. Document text never goes in the
database, review sets have a document ceiling that is refused rather than silently exceeded, bulk
loading runs in its own lane so it cannot slow ordinary file uploads, and a resumable coordinator
survives restarts mid-load. Semantic search over a review set is opt-in, because embedding hundreds of
thousands of documents costs real money whether or not anyone runs a semantic query.

Two specs, one decision record, four build sub-slices, and ten owner decisions each carrying a
recommended default. No product code in this cycle.
