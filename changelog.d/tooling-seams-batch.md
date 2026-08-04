---
category: Fixed
---

**The conversion queue consumer now resolves its R2 bucket through the firm-bucket seam.** It read the
source object and wrote the converted result through the bound binding directly while the conversion
routes presigned both legs through `resolveFirmBucket` — precisely the split the seam exists to prevent,
and one that would send a job's bytes to a bucket the other half never looks in the moment a firm gets
its own bucket. The firm's recorded bucket now travels on the conversion queue message (as it already
does for a bundle build), so the consumer reads and writes through the very bucket the upload was
presigned against rather than deriving one of its own, and the status route heads the result artifact
through the same resolved handle. The fitness scan that holds modules to the resolver covers both
conversion modules, so the bypass cannot come back unnoticed.

**`pnpm check:scoped` no longer diffs against a frozen `main`.** It resolved its base by trying local
`main` first and only falling back to `origin/main`, so in any worktree whose local `main` has not moved
since it was created — every agent worktree — the merge-base landed hundreds of commits behind and the
scoped gate stopped being scoped: it linted every file the trunk had touched in the meantime, slowly and
noisily, and a few hundred files was enough to take the linter down with it. The base is now the newest
of the merge-bases the trunk refs offer, ordered by ancestry rather than by commit date (a rebased commit
can carry an older date than a commit it descends from), with the previous behaviour intact whenever only
one ref resolves and `--base <ref>` still overriding both.

**`vp run bootstrap` no longer reports success over stale wasm.** Staleness was an mtime comparison
between the Rust sources and the emitted `.wasm`, which cannot see the failure that actually happens:
every worktree shares one cargo target directory, so a build can be served from a cached compilation of
sources that are not the ones on disk, wasm-bindgen re-emits the bindings from that cached artefact, and
the emitted files get a fresh mtime that reads as "current" — leaving a package missing a function it is
supposed to export, with the failure surfacing much later as `X is not a function` at runtime. Each
output now carries a stamp holding the content hash of the sources it was built from (its crate, that
crate's workspace-local path dependencies — which the mtime check never looked at — and the workspace
manifests), and no build is believed until the emitted bindings are verified to export everything the
crate's `#[wasm_bindgen]` surface declares. An artefact that comes out incomplete has its crate's cargo
cache discarded and is rebuilt once; if it is still incomplete the command fails loudly instead of
stamping a broken artefact as current.
