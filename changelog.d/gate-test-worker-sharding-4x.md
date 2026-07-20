---
category: Changed
---

**CI `test-worker` job sharded 4-way.** The Miniflare Workers pool — the gate's heaviest test
substrate at ~6.3 minutes per shard at 2x — now runs at 4x, landing each shard around ~3.2 minutes.
`test-node` and `test-stories` are already cheap and unchanged.
