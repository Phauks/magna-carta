---
category: Changed
---

**CI test job split by substrate instead of a blind shard draw.** The gate's single 4-way test shard
is now three jobs: `test-node` (packages + `apps/web` + tooling, sharded), `test-worker` (the
Miniflare Workers pool — the heaviest substrate, sharded), and `test-stories` (the only browser
suite, the only job installing Chromium). The partition is complete by construction (fails loud on a
mis-scoped file via `passWithNoTests` off), wall-clock is now paced by the heaviest substrate
(~6 minutes, worker) instead of a random file draw, and Playwright installs once instead of on every
shard.
