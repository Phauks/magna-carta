---
branch: claude/overnight-small-batch
worktree: .claude/worktrees/agent-ab5eba5be208701ff
area: two independent small items — engine-host stack-overflow investigation, and a scoped formatter entry point (`pnpm fix:scoped`)
status: review
touches: crates/engine-host/src/format.rs, tooling/check-scoped/, package.json, CLAUDE.md, docs/conventions/build-performance.md, changelog.d/
---

One batch, two unrelated items.

**engine-host stack overflow (investigation, no cause found in the code).** `detects_ole2_compound_file_by_magic` overflowed its stack once on a cold per-worktree cargo target and has not recurred. Twenty-six cold-target runs — six clean, twenty with all four cores saturated, 6 GiB of memory pressure and `--test-threads 16` — plus two full `vp run rust-check` runs did not reproduce it. Bisecting `RUST_MIN_STACK` over the real test binary puts the whole crate's peak demand between 64 and 128 KiB, and every kilobyte of that belongs to the axum/reqwest host tests, not the detection path: the format tests still pass on a 16 KiB stack. The conclusion is environmental, so nothing in the toolchain was changed on a hypothesis; what landed is a regression guard in `crates/engine-host/src/format.rs` that runs `detect` on a 64 KiB thread stack, so a future recursive or large-frame implementation fails everywhere rather than occasionally.

**`pnpm fix:scoped`.** A repo-wide `vp check --fix` has overreached three times. The new script (`tooling/check-scoped/fix.mjs`) applies the formatter and lint autofixes to exactly the change set `pnpm check:scoped` verifies, sharing one implementation with it (`tooling/check-scoped/changed-files.mjs` — extracted from `index.mjs`, which now calls it). Markdown is included. `CLAUDE.md` gains one line in the Commands block, next to `check:scoped`; `docs/conventions/build-performance.md` names it as the default fix invocation.
