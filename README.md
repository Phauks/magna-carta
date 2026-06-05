# Magna Carta

Legal practice-management platform on Cloudflare. See [`CLAUDE.md`](CLAUDE.md) and [`docs/`](docs/).

## Quickstart

- `vp install` — install deps
- `vp dev` — web SPA dev server (HMR only)
- `vp run worker-dev` — full local app: builds the SPA then runs `wrangler dev` on Miniflare (local D1/R2/Queues)
- `vp run build-all` — build all apps in dependency order
- `vp test` — run tests (including the Miniflare worker integration test)
- `pnpm check` — full quality gate (format + lint + TS type-check + svelte-check); what CI runs
