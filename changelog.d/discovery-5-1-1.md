---
category: Added
---

The discovery engine — the pure-Rust core that reads a document a firm did not write. The first
built piece of Discovery, and deliberately the piece with no Cloudflare, no database, and no worker
in it: everything the rest of the subsystem does is a function over what this engine says about a
document.

**It reads the bytes, and it cannot read the name.** A production's file names are wrong often
enough that routing on them is how a spreadsheet gets read as a picture — and a name is also the one
part of a hostile file the other side controls most cheaply. So identification takes bytes and
nothing else: there is no parameter a file name could arrive through. Comparing the two answers is a
separate call whose result is **reported and never acted on**, so a spreadsheet renamed `.jpg` still
identifies as a spreadsheet and the lie ends up in the record instead of in the routing. A ZIP is
refined into the package it actually is — a Word document, a workbook, a presentation, an
OpenDocument package, or a plain archive of loose files — and a compound file into a legacy Word,
Excel, or PowerPoint document, an Outlook message, or an encrypted Office package, all from entry
names, with nothing decompressed to learn it. A format the engine cannot read is named anyway,
because "we could not read this, and it was a legacy WordPerfect document" is a defensible sentence
and "extraction failed" is not.

**A born-digital PDF now extracts its real text.** The platform's extraction port shipped backed
only by recognition, which skips pages that already carry a text layer — so the single most common
document in a law firm extracted to nothing and was recorded unextractable. This engine reads the
page's own glyphs, and reports per page which pages have words only as pixels, so a document whose
text is already there is never photographed and guessed at. A scan still goes to recognition; a
contract with a scan appended sends only the scanned half. That is a platform-wide correctness fix
that happens to have been forced by discovery.

**Everything derived is derived from one canonical form.** Line endings, canonical composition,
typographic and non-breaking spaces, invisible zero-width characters, and stray control bytes all
settle in one place before anything is chunked, hashed, or fingerprinted — because two copies of one
document that render identically must deduplicate, and a document with joiners smuggled between its
letters must not be able to evade that. The passage chunker moved out of TypeScript into the shared
engine **byte for byte**, carrying its own test corpus with it: the desktop client and the server run
the same engine over the same document into one index, and an index that disagrees with itself about
what a document says is not an index.

**Archives open, under five guards, in exactly one place.** A production received from another party
arrives as a zip, and a discovery subsystem that cannot open one cannot ingest an external production
at all. So the opaque-archive rule narrows to the File Manager, and the discovery path expands —
under nesting-depth, total-bytes, expansion-ratio, and entry-count ceilings, plus unconditional
rejection of any entry whose path tries to escape, every one of them checked before a decompressed
byte is kept. A zip bomb trips the ratio guard rather than memory. An encrypted entry is reported and
its nine thousand siblings still load. An archive nested past the ceiling is described honestly
rather than opened or dropped. An archive can also be listed without decompressing anything at all,
which is what lets an unexpanded one still be accounted for rather than shrugged at.

Also: the five digests e-discovery load files ask for (including MD5 and SHA-1, carried as
legacy-interop exactly as the platform already labels them) in one pass over the bytes; a
deterministic near-duplicate fingerprint computed where the text is already in memory, because
retrofitting it across a production is not a migration but a second processing run; each format's
best available document date, reported verbatim with the source named rather than converted; and a
page count where the format actually has pages, because Bates numbering will need it and it cannot be
recovered later without re-reading every byte.

**Every parser in it is memory-safe, and that is enforced rather than intended.** Discovery ingests
hostile files at scale — the worst case the rule exists for, not an edge case — so no C-backed codec
feature is selected on any path, and a test that reads the engine's own manifest fails if one ever
is. A malformed, truncated, encrypted, or absurd input is always a named error and never a panic, and
a sweep runs every fixture through truncation, bit-flips, and inflated length fields against every
entry point on every test run.

The engine is hosted by its own container and worker rather than sharing the search container, whose
whole premise is staying warm for sub-second queries: a bulk load that made review search slow is the
one combination a discovery user would actually hit. It has no outbound network access.

Nothing calls this engine yet. The review-set model it produces facts for, the queue lane that feeds
it, and the wiring into the search pipeline are the sub-slices after it.
