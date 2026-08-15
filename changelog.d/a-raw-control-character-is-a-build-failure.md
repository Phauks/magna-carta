---
category: Added
audience: internal
---

**Raw control characters in tracked source and Markdown now fail the gate; write the escape.**
`pnpm run lint:control-characters` (`tooling/lint-control-characters.mjs`) rejects every C0 byte and
DEL that is not tab, newline, or carriage return, prints the exact escape to write in its place, and
runs in the governance job beside the process-reference scan and in the pre-push hook.

The reason is legibility rather than correctness: a raw NUL is invisible in a file read, in
`git diff`, in a review pane, and in most editors, so the source reads as one thing and means
another. A separator written as a literal NUL read as `.join("")` to two separate readers on the same
day and produced a wrong diagnosis of a real defect. The escape is the same value at runtime and says
what the byte is.

Ten source files carried eighteen raw bytes and all were converted: the hash-domain separators in
`joining-secrets.ts`, four composite map keys (`scoped-setting-statements.ts`, `normalize.ts`,
`matter-suggestion.ts`, `fusion.ts`), the three in `metering-statements.ts` including the `split()`
that had to agree with them, the C0 range in the assembled-document-name regular expression, and two
tests whose subject IS the byte — the expression fuzz alphabet, the denied-construct corpus, and the
zip local-file-header magic in the JPEG appended-data test. None needed the escape hatch; the escape
is clearer in the tests too, which is where the argument for the raw byte would have been strongest.

The scan covers Markdown, which the process-reference scan deliberately exempts. That is not
symmetry for its own sake: a code sample in a document gets copied into source, one spec already
carried a NUL inside a cache-key sample, and the first draft of this rule's own convention entry was
written with a raw escape byte in its prose. It self-tests on every run, on the ledger-staleness
idiom — over invisible bytes, a check that has quietly stopped firing is indistinguishable from a
clean tree.
