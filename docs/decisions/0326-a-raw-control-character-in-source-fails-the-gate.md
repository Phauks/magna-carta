---
number: 326
slug: a-raw-control-character-in-source-fails-the-gate
status: Proposed
date: 2026-08-14
area: Tooling
summary: "A source-scan fitness function, pnpm run lint:control-characters, rejects every raw C0 byte and DEL in tracked source other than tab, newline, and carriage return, and requires the escape form instead. The argument is legibility, not correctness: the raw byte is invisible in a file read, in git diff, in a review pane, and in most editors, so the source reads as one thing and means another — a separator written as a literal NUL read as .join('') to two separate readers on the same day and produced a wrong diagnosis of a real defect. Ten files carried eighteen bytes and every one was converted rather than exempted, including the tests whose subject IS the byte, where the escape is clearest. The scan covers Markdown, which the process-reference scan deliberately exempts, because a code sample in a document is copied into source and one spec already carried a NUL in a cache-key sample. It self-tests on every run, on the ledger-staleness idiom: over invisible bytes, a check that has quietly stopped firing is indistinguishable from a clean tree. The escape hatch is a same-line control-characters:allow marker with a required reason, and nothing in the repository needed it."
---

**An invisible byte is a lie the file tells every reader. The escape is the same value at runtime, so
there is no case where the raw form is clearer — and the rule can therefore be absolute.**

**Context:** five tracked source files were known to carry literal control characters, and a sixth had
been repaired for unrelated reasons. Scanning properly found ten, holding eighteen bytes: NUL used as
a composite-map-key separator in five packages, NUL as a hash-domain separator in the joining-secrets
module, the C0 range written raw inside the character class of the assembled-document-name regular
expression, and three test fixtures whose subject is the byte itself — the expression fuzz alphabet,
the denied-construct corpus, and the zip local-file-header magic in the JPEG appended-data test.

None of them is a defect. Every one is unreadable. `` `${firmId}${userId}` `` and
`` `${firmId}\0${userId}` `` are the same expression and only the second says what it does; the first
reads as string concatenation with no separator at all, which is a real and different bug it is
indistinguishable from. That is not a hypothetical: earlier the same day, a `.join("\0")` written with
the literal byte read as `.join("")` to two separate readers and produced a wrong diagnosis of a real
defect. The cost of the mistake is a wasted investigation; the cost of the rule is one character.

**Decision:** a scan on the shape of `tooling/lint-process-references.mjs`, wired into the same
governance job and the same pre-push hook. Tab, newline, and carriage return are legal raw; every
other C0 code point and DEL is a failure naming the file, the line, the column, the code point, and
the exact escape to write. It scans decoded code points rather than bytes, so a C1 code point is not
confused with a UTF-8 continuation byte.

**Convert, do not exempt — the tests especially.** The strongest case for a raw byte is a test whose
whole subject is that byte, and it does not survive contact: `Array.from("PK\u0003\u0004", …)` names
the zip local-file-header magic and the raw form names nothing. All eighteen were converted and the
escape hatch is unused. It exists — a same-line `control-characters:allow` with a required reason, on
the marker-plus-reason idiom the ledger-staleness scan and the object-dimension scan already use — for
a line where writing the escape would change what the line proves. A bare marker with no reason fails.

**Markdown is scanned, unlike the process-reference rule.** That scan exempts documentation because
citing an ADR is documentation's job. Nothing analogous is true here: a control byte in prose is
invisible to a reader of the prose too, and a code sample in a document gets copied into source. One
implementation plan already carried a NUL inside a cache-key sample, and the first draft of this
rule's own entry in `docs/conventions/code-style.md` was written with a raw escape character in its
prose — which is the argument, made by the rule's own author, one paragraph after stating it.

**The scan self-tests before it scans**, on the `lint-ledger-staleness` idiom, and this is the case
where that matters most. A pattern that has silently stopped matching reads as a permanently green
gate, and over bytes nobody can see there is no second signal that would eventually give it away. The
fixtures are assembled with `String.fromCodePoint` rather than written as literals: a raw control
character in the scan's own source would be exactly what it bans, and an escape would still be an
escape, so neither literal form would prove the scan sees a real one.

**Consequences.** Eighteen one-character edits across ten files, no behaviour change, and one class of
misdiagnosis retired. The scan reads every tracked code and Markdown file on each run, in the
governance job that already walks the same tree.
