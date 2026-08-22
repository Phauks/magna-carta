---
worktree: C:/dev/magna-carta-worktrees/claude/file-version-uploader-pii
area: Erasure coverage for file_version.uploaded_by
status: review
touches: packages/data-access/src/pii-registry.ts, changelog.d
---

One registry reclassification: `file_version` moves out of the no-personal-data list and gains a
`pseudonymize-keep` rule on `uploaded_by`, matching the three existing tables of the same shape. No
schema change, no wire change, no route change.
