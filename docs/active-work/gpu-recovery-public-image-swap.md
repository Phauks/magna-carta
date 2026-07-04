# gpu-recovery-public-image-swap — active work

**Stream:** GPU recovery — swap Stage-1 harness to the proven public-image approach + record measured rig profiles + capture Stage-2 design decisions.
**Owner:** Trevor Goldsmith · **Branch:** `gpu-recovery-public-image-swap` · off `main`. NOT merged.

## Why (proven live 2026-07-04)
Ran the real benchmark on vast.ai with the owner's key. Learnings:
- **No custom image / build / registry needed.** Rent a public `dizcza/docker-hashcat` image + `onstart` running `hashcat -b`; collect via the vast.ai logs API. Zero Docker, zero build — fits the "unified git-driven lifecycle" goal. Retire `containers/recovery-gpu` + serverless-registry as the primary path (custom image only if Stage 2 ever needs baked wordlists).
- **Live-API corrections (the merged client is WRONG on some):** search = `POST /api/v0/bundles/` with FLAT operator query; list = `GET /api/v1/instances/`; **destroy = `DELETE /api/v0/instances/{id}/` (v0, NOT v1 — the merged "fix" got this wrong)**; create = `PUT /api/v0/asks/{id}/`; gpu_name uses SPACE ("RTX 4090"); response has `verification` (string) not `verified` (bool). `runtype:"ssh"` needed so the container stays alive.
- **Collection:** `PUT /api/v0/instances/request_logs/{id}/` → `result_url` (S3) → GET it. No SSH key needed.
- **Bad GPUs happen:** the 4090×4 rig failed to boot (OCI/host error). MUST retry a failed rig on the next-cheapest offer (bounded), never let one bad rig fail the sweep/job.

## Owner decisions (Stage 2 rig policy)
- **RTX 5090 is the chosen card** (best $/hash measured). **H100 excluded** (measured slowest AND priciest for hashcat — datacenter cards are wrong for this). 4090 fallback.
- **single GPU → layer 1 (shallow/basic)**; **multiple GPUs / multiple concurrent runners → layer 2+ (medium/deep)**. Multi-GPU is same $/hash, faster wall-clock — good for deep tiers.

## This branch's work
1. Record measured rig profiles → `docs/research/gpu-recovery/rig-profiles.json`.
2. Update the Slice-3 design doc with the proven approach + these decisions + measured data.
3. Swap the harness: client destroy→v0; public-image + runtype:ssh + inline-onstart; logs-API CollectFn (replace ssh-collect); bad-GPU retry-on-next-offer; retire custom-image/serverless-registry runbook.

## Expected files
`packages/gpu-benchmark/src/{vast-client,run,cli,onstart}.ts` + logs-collect; `docs/research/gpu-recovery/rig-profiles.json`; `docs/specs/2026-07-03-decryption-slice-3-gpu-recovery-design.md`; retire `containers/recovery-gpu/` + the README serverless-registry runbook. Reuse the live-verified endpoints above.
