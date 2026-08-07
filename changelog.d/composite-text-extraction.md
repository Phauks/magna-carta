---
category: Fixed
---

Search — text extraction is composite and per page, so a born-digital PDF is searchable. The shipped
`TextExtractionPort` was backed only by the recognition engine, and that engine deliberately skips a
page that already carries a text layer — recognizing a born-digital page is slower, worse, and returns
a reading of a picture of the text rather than the text. Correct for a recognizer, and fatal for an
extractor: routed through recognition alone, **a born-digital PDF came back with no lines on any page
and the write pipeline recorded it `unextractable`** — no split, no catalog row, absent from every
search. That is the most common document a law firm holds, and it was the whole of the platform's
search-index write path.

Extraction now reads the document's own text layer first, in pure Rust (`crates/pdf-core`), and sends
only the pages that have no usable text layer on to recognition. **The routing is per page, not per
document**, because a scan appended to a born-digital contract is one document with pages of both
kinds: whichever way a whole-document router sent it, half of it would be lost. The result carries
per-page provenance — `native` or `ocr` — so a consumer that has to account for its corpus can tell
the characters the author typed from a recognizer's best reading of a picture of them.

Which pages still need recognizing is decided by one function in `pdf-core`, and the recognition
container now asks that same function rather than keeping its own copy. If the extractor and the
recognizer ever disagreed about a page, it would be read twice or by neither — a duplicate in the
index, or a page silently absent from the corpus. The rule itself is unchanged and still weighs text
against what it sits on, so a Bates stamp on a scanned page does not make the page look like it has a
text layer. Reading the layer, unlike measuring it, includes _invisible_ glyphs: what recognition
writes back onto a scan is an invisible layer, so skipping those would have made this product's own
searchable PDFs extract to nothing.

Reconstructing text from glyphs is where the work is. A PDF stores positioned glyphs, not words —
a space character has no outline, is never drawn, and is never observed — so every space is inferred
from the distance between the glyphs on either side of where it was. Lines are grouped on baselines
rather than box centres (a full stop shares a baseline with the capital beside it, but its centre sits
most of an x-height lower), and the word gap is measured against each line's own spacing rather than a
fixed fraction of the type size, because letters are not always set at their natural widths: the
invisible layer this product writes onto a scan stretches each recognized run to the width of the box
it was read in, and a fixed threshold reads that as one space per letter.

A document whose pages all carry their own text now extracts with **no recognition call at all**,
which for an ordinary firm's corpus is the difference between a parse and a rasterize-and-infer per
page. Measuring a page and reading it are one observation pass instead of two, so the recognition
container's own gate got cheaper as well.

**Documents already recorded unreadable are repaired.** A re-extraction sweep on the existing daily
reconciliation cron re-enqueues every committed, clean, current document version the per-firm catalog
holds no live split for — which is exactly the set that fell out of the corpus, and also repairs an
enqueue that lost its race after ingest, an engine outage that dead-lettered, and a firm that enabled
indexing after loading its documents. Nothing is deleted and nothing is marked: the catalog already
knew which documents were missing. The pass is convergent (a repaired document stops being a
candidate), bounded per firm per run so a whole back catalogue drains over several days, and it reads
the same per-firm indexing switch the ingest path does, so a firm that has not opted in is untouched.
