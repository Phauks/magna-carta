---
slice: File Unlock & Password Recovery
group: cross-cutting
order: 23
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: done by="Sonnet 5"
load-profile: n/a
tested: done by="Opus 4.8" awaiting
branch: main
active-work:
next: GPU rung Stage 1 (benchmark harness @magna-carta/gpu-benchmark) built — owner benchmark run + Stage 2 wiring next; connect the magna-carta-recovery Worker to Workers Builds
link-spec: docs/specs/2026-06-26-decryption-tool-design.md
link-plan: docs/specs/2026-06-26-decryption-slice-2-plan-2-orchestration-implementation-plan.md
adrs: decryption-file-unlock-recovery, decryption-recovery-orchestration
blocked-by:
---

`crates/decryption-core` (pure Rust → wasm + native) behind `FormatAdapter`: unlock (`/decryption/inspect` + `/unlock`) and recover (DO-coordinated fan-out over `apps/recovery-worker` shards, `/decryption/recover*`). PDF/ZIP/OOXML; hash-only recovery boundary; GPU rungs deferred. The File Workbench's Unlock capability is now real (attest, unlock with a known password, or start a recovery search that hands off to its own addressable job screen — poll, cancel, one-time password reveal, an honest needsGpu answer rather than a spinner that never finishes). A PDF's own reader also unlocks a known password without leaving the page: `@magna-carta/pdf` already carries `inspectSecurity`/`decryptDocument`, loaded client-side in the same worker that rasterizes pages, so trying a password costs nothing server-side and a reader who does not have one is linked straight to the workbench's Unlock capability, where Recover lives.
