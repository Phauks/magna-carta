---
slice: File Unlock & Password Recovery
group: cross-cutting
order: 23
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: todo
load-profile: n/a
tested: done by="Opus 4.8" awaiting
branch: main
active-work:
next: GPU rung Stage 1 (benchmark harness @magna-carta/gpu-benchmark) built — owner benchmark run + Stage 2 wiring next; end-user UI (post-0·7); connect the magna-carta-recovery Worker to Workers Builds
link-spec: docs/specs/2026-06-26-decryption-tool-design.md
link-plan: docs/specs/2026-06-26-decryption-slice-2-plan-2-orchestration-implementation-plan.md
adrs: decryption-file-unlock-recovery, decryption-recovery-orchestration
blocked-by:
---

`crates/decryption-core` (pure Rust → wasm + native) behind `FormatAdapter`: unlock (`/decryption/inspect` + `/unlock`) and recover (DO-coordinated fan-out over `apps/recovery-worker` shards, `/decryption/recover*`). PDF/ZIP/OOXML; hash-only recovery boundary; GPU rungs + UI deferred.
