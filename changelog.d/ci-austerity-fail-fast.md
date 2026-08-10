---
category: Changed
---

**Gate now stops on first failure while CI austerity is in effect.** The `wasm`, `rust`, and
`containers` jobs wait on the `format` tripwire before starting, and the sharded `node`/`worker` test
matrices run with `fail-fast: true`, so a doomed run stops spending runner minutes instead of finishing
the whole battery. Not gated on the dependency-audit job, so a new upstream advisory never cancels a
green test run. Marked `TEMPORARY CI AUSTERITY 2026-08-07` for the September 1 revert alongside the
other austerity measures.
