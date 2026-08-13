# claude/clean-squash-merge

**Scope.** Make `vp run clean` actually sweep. Its merged-branch test is pure ancestry, which never
matches in a squash-merge repository, so the post-merge auto-clean hook has reclaimed nothing since
it was installed.

**Files touched.**

- `tooling/clean/index.mjs` — baseline ref, the content test, the report line
- `tooling/clean/select.mjs` — `landedBranches` (replaces the caller-supplied merged set)
- `tooling/clean/select.test.mjs` — cases for squash-landed, ancestry-merged, fresh workspace,
  conflicting
- `changelog.d/clean-sweep-squash-merges.md`

No overlap expected with any other stream: nothing else in flight touches `tooling/clean/`.
