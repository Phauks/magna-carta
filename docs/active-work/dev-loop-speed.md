---
branch: dev-loop-speed
worktree: C:/dev/magna-carta-worktrees/dev-loop-speed
area: Developer feedback loop (build-time performance + working conventions)
status: built 2026-07-11; not yet merged.
touches: package.json (check:scoped + bootstrap scripts), vite.config.ts (bootstrap task), NEW tooling/bootstrap/, NEW tooling/check-scoped/, .gitignore (crates/.cargo/), CLAUDE.md (golden rule 7 — canonical shell + path form; How we work — bootstrap/inner-loop + edit-ownership), docs/conventions/build-performance.md (scoped check + bootstrap sections), changelog.d/
---

Closes the measured gaps in the local feedback loop. Cross-cutting but small: two tooling scripts,
their wiring, and the conventions that point at them. **No product code, no schema, no API.**

**Why.** An audit of the working sessions in this repo put the cost where nobody had looked:

- The full gate ran **2,028 times for 18.5 hours of wall-clock, and 93% of those runs found nothing** —
  `pnpm check` is seven serial whole-repo passes whose cost is fixed regardless of diff size, and the
  pre-push hook runs it anyway.
- Every new worktree starts **without** the git-ignored Rust→WASM artefacts under
  `packages/{pdf,decryption,email}/src/pkg/`, so each one independently rediscovers that fact and
  cold-builds them (measured single builds: 422s, 241s, 199s). Cargo's `target/` is per-worktree, so
  each of the ~19 live worktrees also keeps its own cold Rust cache.
- PowerShell invocations fail **~4x** as often as Bash ones (16.3% vs 4.0%), almost all of it the
  heredoc/here-string and path-idiom collision between the two shells.
- Sibling worktrees sit outside the project directory, so reading a file in one prompts for permission
  every time.

**Built.** `vp run bootstrap` (`tooling/bootstrap/`) — rebuilds only stale wasm artefacts, no-op when
current, and points cargo at one target dir shared by every worktree (`~/.cache/magna-carta/cargo-target`,
via a git-ignored generated `crates/.cargo/config.toml`; `MAGNA_CARTA_SHARED_CARGO_TARGET=0` opts out).
`vp run rust-wasm-build` (Docker) stays the canonical build for the deploy pipeline. `pnpm check:scoped`
(`tooling/check-scoped/`) — the inner loop: fmt + lint on the diff, incremental `tsc -b`, and
svelte-check/Rust only when a `.svelte` file or a crate was touched; it reports what it skipped.
`pnpm check` is unchanged and remains the gate of record on pre-push.

**Owner action still open.** A project `.claude/settings.json` (read-only command allow-list +
`additionalDirectories` for the worktrees root) was drafted but NOT written — it widens the agent's own
permissions, so it is the owner's call to apply. It is the fix for the permission-prompt friction above.
