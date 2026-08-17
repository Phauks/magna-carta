---
category: Fixed
audience: internal
---

**`pnpm test tooling` collected nothing and reported that the directory had no tests. It now collects
all 34 files, and a filter that genuinely selects nothing says which of the two happened.** The
snapshotter also reaps its own working copies again, after ~125 of them filled a disk.

Three unrelated pieces of developer-tooling friction, batched because they live in the same two
directories.

**A directory filter now resolves across projects.** The runner matches a positional filter against
each project's OWN root-relative paths, and every `tooling/*` project roots at its own directory —
so `tooling` matched nothing anywhere: relative to `tooling/clean`, its one test file is
`select.test.mjs`, a string not containing "tooling". `packages` and `apps` had the same shape. That
made the documented idiom — the root `CLAUDE.md` says to filter by PATH, not by test name — fail on
the directories most likely to be filtered that way, and answer with "No test files found", which
reads as _nothing here has tests_ rather than _your filter matched nothing_. An absolute path always
did resolve, which is why the gate's test jobs spell every path `"$PWD/tooling"` — not a style choice
there either, after a relative `packages` filter once collected zero of the packages' tests while the
gate stayed green. `pnpm test` now resolves a directory filter to its absolute path before the runner
sees it (`tooling/test-single-flight/path-filters.mjs`), so the short spelling means the working one
and nobody has to know the gate's idiom. Filters that are not directories — `select.test.mjs`, an
option's value — are passed through untouched.

**And a selection that provably cannot match is refused before the lock is taken**, naming the filter
and saying that it matched nothing rather than that the directory is empty. The one refusal condition
is proof, not heuristic: the project list in `vite.config.ts` is closed, so a directory with no
registered project at, above, or inside it can never yield a file however the filter is spelled. A
directory that does hold a project but whose `include` globs happen not to cover it is left to the
runner — proving that case would mean re-implementing glob resolution, and a wrong refusal blocks a
run that would have worked.

**The load-profile snapshotter reaps its own working copy.** It `mkdtemp`s a directory per load and
copies the whole snapshot database into it; nothing removed them, and ~125 accumulated to ~8 GB until
the box hit 100% disk. Reaping now belongs to the code that created the directory — the only code
that knows its name — on close, in a `finally` so a failed handle-close still reaps, and on process
exit, because the measure CLI is a straight-line script whose mid-run throw never reaches its own
`close()`. That is how they leaked. As a backstop for a run killed outright, `vp run clean` sweeps
abandoned copies older than 24 h. The sweep matches the `mkdtemp` name shape exactly rather than by
prefix, so it cannot take the fixture cache that shares the prefix and belongs to a different
creator, and the age bound is the whole safety argument for deleting by name: without it the sweep
would race a live run and delete the database it was measuring against.

**The inner loop's wasm-artefact precondition is left as it is, deliberately, and now says why.** It
looked like the one unconditional step in a gate that scopes everything else to the diff — svelte-check,
the Rust gate, drizzle snapshots and the fitness sweep all skip with a stated reason. Scoping it to
the diff is nevertheless wrong, and measuring said so: in a fresh worktree `vp run typecheck` fails
with twelve `TS2307`s on the missing generated `.d.ts` files. That step is itself unconditional and
`tsc -b` builds the whole reference graph, so whether the artefacts are needed is a fact about the
build graph, not about the diff — no diff-shaped condition can be both sound and useful. Skipping the
check would only trade one clear message naming its own repair for twelve confusing ones. The
reasoning is recorded at the step and in `docs/conventions/build-performance.md` so the next reader
reaches the same conclusion without re-measuring.
