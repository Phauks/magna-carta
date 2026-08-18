---
worktree: (none — this stream runs in the primary checkout)
area: Passive development — whatever fix or slice is in front of it, plus the feature ledger and the documents rendered from it
status: building
touches: roadmap.d/, docs/now.md, docs/now.html, docs/decisions-open.html, changelog.d/, tooling/doc-fragments/, packages/document-assembly/CLAUDE.md
---

Currently surfacing the PDF scrub's active-content question onto the decision desk: no code change,
one ledger node and the three documents rendered from it. This stream touches `roadmap.d/` on most
passes, which is every other stream's collision surface — a branch that flips a node's status while
this one is rendering conflicts on all three generated documents. Sync before flipping one, and
rebuild with `vp run register-build` rather than editing the output.
