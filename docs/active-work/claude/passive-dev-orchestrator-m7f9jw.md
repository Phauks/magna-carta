---
worktree: (none — this stream runs in the primary checkout)
area: Passive development — whatever fix or slice is in front of it, plus the feature ledger and the documents rendered from it
status: building
touches: roadmap.d/, docs/now.md, docs/now.html, docs/decisions-open.html, changelog.d/, tooling/doc-fragments/, packages/document-assembly/CLAUDE.md, packages/file-manager/src/verdict.ts, packages/file-manager/src/ingest-core.ts, packages/file-manager/CLAUDE.md, apps/worker/src/files/ingest-consumer.ts, apps/worker/src/routes/templates.ts, apps/worker/test/ingest-consumer.test.ts, apps/worker/test/pdf-form-templates.test.ts
---

Currently holding the scan-verdict badge in one place: `scanDetailFor` in
`packages/file-manager/src/verdict.ts` is what every committing writer records into `scan_detail`,
and the three that decided it separately — ingest, template registration, and the weekly re-scan —
now all call it. Two of the three were wrong. A concurrent stream touching the ingest pipeline, the
template registration route, or the scan verdict will collide here.

This stream also touches `roadmap.d/` on most passes, which is every other stream's collision
surface — a branch that flips a node's status while this one is rendering conflicts on all three
generated documents. Sync before flipping one, and rebuild with `vp run register-build` rather than
editing the output.
