### Added

- **`vp run bootstrap` — make a fresh worktree runnable in one command.** The Rust→WASM artefacts that
  `packages/{pdf,decryption,email}` import are generated and git-ignored, so a new worktree began life
  unable to type-check or test those packages until someone rediscovered why. Bootstrap builds only the
  artefacts whose Rust inputs changed, is a no-op when they are current, and points cargo at a target
  directory shared across worktrees so the second worktree's build is a cache hit rather than a cold
  dependency compile. The pinned-Docker `vp run rust-wasm-build` remains the canonical build for the
  deploy pipeline.
- **`pnpm check:scoped` — the inner-loop quality gate.** Runs only what the current diff can break:
  format and lint on the changed paths, the incremental `tsc -b` type-check, and `svelte-check` or the
  Rust gate only when a `.svelte` file or a crate was actually touched, reporting whatever it skipped.
  The full `pnpm check` is unchanged and remains the gate of record — the pre-push hook runs it.

### Changed

- **Bash is the canonical shell for this repo** (golden rule 7), with PowerShell reserved for genuinely
  Windows-native work. The two take opposite multi-line-string and path idioms, and mixing them was a
  measurable source of failed commands. Paths are written in one canonical form, passed absolutely
  rather than behind a `cd`, so a permission rule can match more than once.
