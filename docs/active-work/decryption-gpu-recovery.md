# decryption-gpu-recovery — active work

**Stream:** File Decryption & Recovery — Slice 3 (Rung 3: cloud-GPU recovery via vast.ai). The GPU escalation rung that fills the `needsGpu` seam Rung 1 left open.
**Owner:** Trevor Goldsmith · **Branch:** `decryption-gpu-recovery` · **Worktree:** `C:/dev/magna-carta-worktrees/decryption-gpu-recovery` · branched off `main` @ a28bb8f · **NOT merged**.

## State
- Design brainstormed + written: `docs/specs/2026-07-03-decryption-slice-3-gpu-recovery-design.md`. Awaiting owner review, then `writing-plans`.

## Decided (don't re-litigate)
- Engine **hashcat** on the rented rig (GR14-consented; never linked into our codebase).
- Trust: only the **bare hash** leaves (no file/metadata); rented marketplace GPUs OK; activation disclosures; vast.ai key Worker-side only; ephemeral instances; surface-what's-sent. No host-vetting/TEE.
- Orchestration: **full `RecoveryGpuCoordinator` DO** + alarm teardown backstop (NOT Cloudflare Workflows — evaluated, deferred to the firm-provisioning pilot; single-resource compensation made it over-powered, and progress needs a stateful surface anyway).
- **Tiered escalation** (shallow NCSC×best64 → larger public list × rules → masks) within **dual caps** ($ budget AND wall-clock, firm default + per-job override), whichever hits first.
- Offer selection on concrete vast.ai fields (`gpu_name`/`num_gpus`/`inet_down`/`dph_total`/`reliability`/`verified`), **never `dlperf`** (a DL-training score, wrong for hashcat).
- **Benchmark-first staging:** Stage 1 = image + benchmark harness → committed rig profiles (owner attaches the vast.ai key to run real rigs); Stage 2 = wired coordinator + escalation + caps.

## Expected files to touch (Stage 2)
`containers/recovery-gpu/*` (or extend recovery image), `apps/worker/src/recovery/*` (GPU backend + coordinator DO), `apps/worker/src/routes/recovery.ts` (status shape), `wrangler.jsonc` (DO binding + migration tag + vast.ai secret), a firm setting for caps, OpenAPI/api-client regen. Reuse the Rung-1 `RecoveryBackend` port + coordinator DO+alarm pattern.

## Reuse anchors
Rung-1 coordinator `apps/worker/src/recovery/recovery-coordinator.ts` (DO + alarm teardown, first-hit-cancel), `recovery-types.ts` (`RecoveryBackend` port), `containers/recovery/` (container contract), `apps/recovery-worker/` (Container app pattern).
