### Added

- **`vp run bootstrap` — make a fresh worktree runnable in one command.** The Rust→WASM artefacts that
  `packages/{pdf,decryption,email}` import are generated and git-ignored, so a new worktree began life
  unable to type-check or test those packages until someone rediscovered why. Bootstrap builds only the
  artefacts whose Rust inputs changed, is a no-op when they are current, and points cargo at a target
  directory shared across worktrees so the second worktree's build is a cache hit rather than a cold
  dependency compile. The pinned-Docker `vp run rust-wasm-build` remains the canonical build for the
  deploy pipeline.
- **`pnpm check:scoped` — the inner-loop quality gate, and now the pre-push hook.** Runs only what the
  current diff can break: format and lint on the changed paths, the incremental `tsc -b` type-check, and
  `svelte-check` or the Rust gate only when a `.svelte` file or a crate was actually touched, reporting
  whatever it skipped. The pre-push hook runs this scoped gate for fast local feedback; the exhaustive
  whole-repo gate now lives in CI (see below).
- **GitHub Actions is the whole-repo gate of record** (`.github/workflows/gate.yml`). It runs the full
  `pnpm check` + `vp test`, the governance lints, migration integrity, all four contract-drift checks,
  and the changed-container acceptance suites on every pull request into `main` and every push to `main`
  — reproducing the Docker WASM build and the Playwright browser the vitest runner needs. Moving the
  exhaustive sweep off the developer's machine and into CI keeps cloud pushes fast (the hook does the
  seconds-long scoped subset) while `main` still only advances on a green whole-repo run.

### Changed

- **Bash is the canonical shell for this repo** (golden rule 7), with PowerShell reserved for genuinely
  Windows-native work. The two take opposite multi-line-string and path idioms, and mixing them was a
  measurable source of failed commands. Paths are written in one canonical form, passed absolutely
  rather than behind a `cd`, so a permission rule can match more than once.
