---
worktree: claude/register-history-rebuild
area: the build register — its history series, and why it stopped moving
status: building
touches:
  - tooling/doc-fragments/register-history.mjs
  - tooling/doc-fragments/build-register-history.mjs
  - tooling/doc-fragments/build-register.mjs
  - tooling/doc-fragments/roadmap.mjs
  - docs/register-history.json
  - docs/now.md
  - .github/workflows/assemble-docs.yml
---

# The register's history series counted parents; the standing above it did not

Format 2 records units of work beside the whole-node counts, so "Where we have been" and "Where the
program stands" are finally the same quantity and the register can stop apologising for it in three
places.

Two things found on the way, both of which are why the series had been frozen since 2026-08-17:

- **A rebuild read the committed file before discarding it**, so a format bump could never be
  executed — `parseHistory` refuses a foreign format with "rebuild it from scratch", and the rebuild
  then died on that same read. A rebuild recomputes every row from git and needs nothing on disk.
- **The reconstruction decides what the trunk is from the ref's NAME**, and the assembly workflow did
  not name one. A checkout leaving HEAD detached would make every scheduled run decline quietly,
  which is indistinguishable from the freeze that actually happened.

The series is rebuilt in this branch against `origin/main` — 83 commits, up from 69, with 19
recorded as unread gaps for a schema-era status the parser no longer accepts. Nothing is estimated.
