---
branch: claude/tooling-seams-batch
worktree: .claude/worktrees/agent-a897429fd930f7f61
area: Three scoped fixes — the conversion consumer's bucket seam, the scoped gate's diff base, and bootstrap's staleness/verification
status: review
touches: apps/worker/src/conversions/conversion-consumer.ts, apps/worker/src/conversions/conversion-types.ts, apps/worker/src/routes/conversions.ts, apps/worker/test/conversion-consumer.test.ts, apps/worker/test/conversion-coordinator.test.ts, apps/worker/test/conversions-routes.test.ts, apps/worker/test/firm-bucket.test.ts, tooling/check-scoped/, tooling/bootstrap/, vite.config.ts, docs/conventions/build-performance.md
---

Three independent defects, one pull request because each is small and none shares a file with another.

**The conversion queue consumer bypassed the firm-bucket seam.** It read the source and wrote the result
through `env.R2` directly while the conversion routes presigned both legs through `resolveFirmBucket` —
the same split the seam exists to make impossible. The firm's recorded bucket now rides on the queue
message (as it already does for a bundle build), so the consumer resolves the very bucket the upload was
presigned against instead of re-deriving one, and the status route's `HEAD` goes through the resolved
handle too. Both conversion modules joined the fitness scan in `apps/worker/test/firm-bucket.test.ts`,
which now holds eight modules to the resolver.

**`pnpm check:scoped` diffed against a frozen `main`.** It tried local `main` first and only fell back to
`origin/main`, so in a worktree whose local `main` is stuck at clone time the merge-base landed hundreds
of commits back and the "scoped" gate linted hundreds of files (enough to take the linter down). It now
takes the newest of the merge-bases the trunk refs offer, compared by ancestry rather than by date. In
this worktree that is 427 files before and 10 after.

**`vp run bootstrap` reported success over stale wasm.** Staleness was an mtime comparison, which cannot
see the failure it needed to: every worktree shares one cargo target directory, so a build can be served
from a cached compilation of different sources, wasm-bindgen re-emits from it, and the emitted files get
a fresh mtime that reads as "current" — the artefact then throws "is not a function" at runtime. Each
output now carries a stamp holding the content hash of the sources it was built from (its own crate, its
workspace-local path dependencies, and the workspace manifests — the old check never looked at
`engine-host` at all), and no build is believed until the emitted bindings are checked to export
everything the crate's `#[wasm_bindgen]` surface declares. A build that comes out incomplete discards the
crate's cargo cache, rebuilds once, and fails loudly rather than stamping.

Do not step on: `tooling/check-scoped/`, `tooling/bootstrap/`, and the `projects` list in
`vite.config.ts` (two tooling test projects are registered there).
