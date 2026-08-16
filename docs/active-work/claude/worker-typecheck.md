---
worktree: /home/user/magna-carta/.claude/worktrees/worker-typecheck
area: bringing apps/worker's 240 test files into the typecheck of record
status: review
touches: tooling/tsconfig-refs/index.mjs, packages/tsconfig/worker.json, apps/worker/src/firm-database/, apps/worker/test/, docs/conventions/build-performance.md, docs/conventions/typescript.md, changelog.d/
---

`apps/worker` is the one graph member whose test project is generated but left out of the root test
solution, so its 240 test files — more than a quarter of the repository's — are checked by nothing.
Two measured reasons stood behind the deferral, and both are being removed rather than worked around.

The first was one file that would not type-check in 600 seconds on its own. The cause is not the file:
`@cloudflare/workers-types` ships its whole surface twice, once as a global script (`index.d.ts`, what
`"types"` loads) and once as a module (`index.ts`, what an `import` resolves to), and comparing the
generic `DurableObjectState<Props>` across those two copies does not terminate in any useful time.
Deleting the import — the ambient global is the same type and is already in scope — takes the file from
over 600 s to 2 s. The same import appears in production source, where it is a latent version of the
same trap; those go too, and a fitness function keeps them from coming back.

The second was 156 errors across the other 234 files, most of them an unchecked `await
response.json()`. Those are being fixed at the seam each one names, no suppressions.

`packages/tsconfig/worker.json` is a shared preset: its `lib` moves to ES2023, which every one of the
repository's ~60 packages already sets and which only the worker preset still lags. It adds
declarations and removes none, so no worker app can be broken by it.
