---
slug: a-file-result-quotes-from-text-kept-in-the-firms-storage
status: Proposed
area: Search
date: 2026-11-10
summary: "A file found by the words inside it quotes the passage it matched, and the words come from the firm's own storage instead of the index. The index job keeps what it extracted, one object per indexed version of a matter's file, written before the catalog says the document is searchable. The search reads one passage of it, by range, only for a file its own statement has already returned, and finds the reader's words again by the engine's own rules. The kept text lives as long as the version's bytes; a discovery review document is not copied."
---

**A file result quotes from text kept in the firm's storage, not from the index.**

**Context:** the owner approved a search result that quotes the sentence it matched
([`docs/specs/2026-11-10-indexing-and-discovery-design.md`](../../specs/2026-11-10-indexing-and-discovery-design.md),
step 6c, and the search mockup approved with it on 2026-11-10). The file contents index holds which
words are on which page and not the sentences, and a matter file's extracted text was discarded once
the split was built. The only other copy, the natural-language feed object, exists only for a firm
and a matter that opted into that feature, so it cannot be what every result quotes from.

**Decision.**

1. **The index job keeps the text it extracted.** One object per indexed version of a matter's
   file, at `extracted-text/{fileId}/{version}` in the firm's own bucket, under a new
   `extracted-text` object class and stamped with the matter. It holds the same passages the split
   was built from, so the page a result names and the sentence it quotes are one reading of the
   document. It is a third consumer of one extraction and never a second extraction.
2. **It is written before the catalog commit, inside the job's outcome.** A failed write fails the
   job and the queue retries it. The alternative, a best-effort write after the commit, leaves a
   searchable document that cannot be quoted and that no later pass has a reason to repair.
3. **It is laid out to be read in part.** A length field, a directory of passages and their byte
   lengths, then the text. A reader takes the first 64 kibibytes, which is the whole object for
   most documents, and at most two more ranges for a very long one. One passage is read to at most
   256 kibibytes.
4. **The application reads it only after its own statement has decided.** The matter search asks
   for quotes for the rows it is about to show and no others. One statement then answers which
   version of each file the index holds, and only for a file on that matter, not deleted, whose
   indexed version is clean. The reader's words are found in the passage again by the engine's
   rules for cutting and folding a word, and about two lines around them become the hit's snippet.
5. **A quote never fails a search and never reaches a log.** A missing object or an unreachable
   bucket leaves the result naming its pages. A fault is reported by its kind alone.
6. **It lives as long as the version's own bytes.** Whatever destroys a committed version's object
   destroys this one with it. A discovery review document is not written: its text is the review
   pipeline's own object, released when the review set closes.

**Alternatives considered.** Storing passage text in the split and having the engine return
snippets was rejected: the engine would hand text back for every candidate before the firm's
database had decided which of them the reader may see, which is the opposite of "the index names
candidates and nothing more", and it would add a document-store read per hit to a query whose cost
is counted in ranged reads. Extracting the file again at search time was rejected as heavy work on
a request a person is waiting for, and as a second reading that could disagree with the indexed
one. Reusing the natural-language feed object was rejected because that object exists only behind
an opt-in and is deleted when a matter is excluded from that feature.

**Consequences.** Each indexed version has one more derived object in the firm's bucket, roughly
the size of its text. A file result costs one statement for the page of results and one ranged read
per file shown, in parallel. An excerpt inside one matter is shown without a download audit event,
on the reasoning the matter search's snippets already rest on: the reader is on the matter and
could open the file. Three things are recorded and not solved: nothing destroys a version's derived
copies until the retention engine calls the purge point in
`packages/file-manager/src/file-service.ts`; turning a firm's file-indexing switch off stops new
reading and deletes nothing; and the matched words are not marked in the quote, because the wire
carries a plain string for every source.
