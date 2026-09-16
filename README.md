# Magna Carta

Legal practice-management platform on Cloudflare. See [`CLAUDE.md`](CLAUDE.md) and [`docs/`](docs/).

## Quickstart

- `pnpm install` — first, in a fresh clone or worktree: `vp` is a devDependency and does not exist until this has run (`vp install` works from then on)
- `pnpm exec vp run bootstrap` — second: builds the git-ignored Rust→WASM artefacts; rebuilds only what is stale
- `vp dev` — web SPA dev server (HMR only)
- `vp run worker-dev` — full local app: builds the SPA then runs `wrangler dev` on Miniflare (local D1/R2/Queues)
- `vp run build-all` — build all apps in dependency order
- `pnpm test` — run tests (including the Miniflare worker integration test); wraps `vp test` in a per-worktree single-flight lock
- `pnpm check:scoped` — the inner loop: format + lint on the diff, incremental type-check, svelte-check/Rust only when touched
- `pnpm gate` — the gate of record, run before a merge: every check the change can reach, from format and governance through the contract-drift checks to the full test battery; `--plan` says what a change will run
- `pnpm check` — the whole-repo static half of that gate on its own (format + lint + TS type-check + svelte-check + Rust)

The full guide is [`CLAUDE.md`](CLAUDE.md).
