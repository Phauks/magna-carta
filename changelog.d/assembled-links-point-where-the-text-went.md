---
category: Fixed
audience: internal
---

**An assembled entry's links point where the text went.** A changelog fragment is written in `changelog.d/` and a pending decision in `docs/decisions/pending/`, and their links are written from there; the assembler moved the text one directory and left the links behind, so `lint:doc-links` refused every rendered file for a mistake nobody made, and the pre-push hook refused every branch with it. `parseFragment` now rebases a fragment's links to the file the text lands in (the root changelog, or the public changelog under `docs/`), `rebasePendingLinks` rebases a numbered decision's links one level up and repoints a sibling link at the sibling's numbered file, and `rewriteReferences` repoints a path link to `decisions/pending/<slug>.md` anywhere under `docs/` at the numbered file alongside the `ADR-<slug>` token it already rewrote. The rendered files on `main` are repaired in the same change, and the 25 baseline entries the repair made stale are deleted.
