---
category: Added
---

The review set — the object the whole of Discovery is a function over. Every deferred discovery
feature (filters, tagging, threading, near-duplicates, the privilege log, production) is a question
asked of one thing nobody had built: **these are the documents under review in this matter, this is
where each one came from, this is whose records they were, and this is what happened when we
processed them.** This builds that, fills it from the firm's own records, and stops before anyone
reviews it.

**A review document is a pointer, and it never becomes a copy.** It names a file version or an email
message the firm already holds — with the hash already computed at ingest and the scan verdict
already recorded — so pulling a thousand of a matter's documents into a corpus moves no bytes and
re-reads none. One blob store, one scan gate, one version model, one hold mechanism, one destruction
policy. And it pins the **version**, not the file: a document that gains a new version tomorrow does
not quietly change what a firm has already certified as the corpus under review. A newer version
enters only through a new load, which is a recorded act with its own record of who did it and when.

**Whose records these were is a first-class fact, and it is two words.** The platform already ships a
register of physical client originals a firm holds in safekeeping — and a lawyer calls the person on
that register a custodian too. One word meaning two different things in the same matter, sometimes on
the same screen, is a defect waiting to be written, so discovery says **record custodian** and never
the bare word, in code, in schema, in comments, and in anything a person reads. A source scan enforces
it both ways. Record custodians belong to their review set rather than to the firm, because the same
name in two matters is not assertably the same person, and asserting it wrongly is not a duplication
problem — it is something a firm gets asked about under oath.

**Every load says whether the firm's own assistant transcripts are in scope, and there is no
default.** A transcript is the firm's work product — its reasoning about the matter, not the client's
records — and whether it belongs in a corpus the firm is about to certify the contents of is a
decision a person makes on purpose. So the field is required, in both directions: a silent exclusion
decides as much for somebody as a silent inclusion would, it just fails the other way, and a firm that
believed transcripts were in scope would learn otherwise after producing. The answer is recorded on
the load itself, so the record can state what the corpus was **drawn from** and not only what landed
in it. Asking to include them is currently answered by name — the lane that reaches them arrives with
the review surface — rather than by silently dropping the request or by claiming a sweep that did not
happen.

**Nothing is dropped quietly, and the counts have to add up.** A document ends in exactly one of two
states: processed, or excepted with a named reason from a closed list of fifteen — because "we could
not read this, and it was a legacy WordPerfect document" is a sentence a firm can stand behind and
"extraction failed" is not. There is no third state and no path that reaches neither, and a load
cannot be marked finished while what arrived does not equal what was processed plus what was
excepted. The database refuses it, not just the code.

**The limit is a refusal, not a slow failure.** A review set carries a document ceiling, and a load
that would carry it past is refused when it is declared — with the count and the ceiling both in the
message, so a firm knows how much to split off rather than guessing. The alternative is a firm
finding out at four hundred thousand documents that its database is full, which is an outage with no
good exit.

**A closed review set gives back its working files and keeps its records.** Closing releases the
extracted text, the metadata, and the search index for collection — all rebuildable from the
originals at any time — while every row, every load manifest, and every exception report stays.
There is no reopen, deliberately: a corpus that could be reopened is a corpus whose contents depend
on when you looked at it.

Also: a load fans out from a coordinator that keeps its place in durable storage rather than in
memory, so a deploy or an eviction partway through a quarter-million-document load resumes where it
actually got to instead of starting over or skipping the rest; an email and its attachments enter as
one family and stay together, because a production that splits them is a production that gets
challenged; a quarantined or unscanned file is refused **by name** rather than skipped, because a
firm that selected fifty documents and silently received forty-eight has a corpus it cannot certify;
and discovery is its own permission scope, so full access to a matter reaches no review set on it —
material another party produced may be attorney's-eyes-only under a protective order, and matter
access must not carry it.

Nothing processes the corpus yet. Reading a document's text, deduplicating, indexing, and the
exception report a litigator actually reads are the sub-slices after this one.
