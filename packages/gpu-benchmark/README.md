# `@magna-carta/gpu-benchmark`

An internal tool that measures hashcat throughput for our recovery hash-modes on rented [vast.ai](https://vast.ai) GPUs, and records the results into `docs/research/gpu-recovery/rig-profiles.json`. Those measured numbers decide which rigs the production GPU recovery rung rents and how deep it can search.

It is **not** shipped to users and is not part of any Worker. It runs on your machine, drives the vast.ai API, and benchmarks a short list of candidate rigs.

## What it does

For each rig in `BENCHMARK_SHORTLIST` (`offer-filter.ts`): rank the marketplace's verified, reliable offers matching that GPU shape cheapest-first → rent the cheapest one running a public hashcat image → wait for boot → collect the benchmark output via vast.ai's logs API → **destroy the rig** → record `{ gpuName, gpuCount, dollarsPerHour, throughput per mode, ... }`. The teardown is guaranteed (a rig is destroyed even if a step fails), so a bug cannot leave one billing.

A rented rig can fail to boot or run at all (observed live: a container-runtime error on one host). When that happens the harness destroys the failed instance and retries on the next-cheapest offer, bounded to a few attempts, before giving up on that rig shape.

The benchmark measures the full mode set — the GPU-band formats (9600 Office, 10700 PDF R6, 11600 7-Zip) and the CPU-band ones (9400/9500/10500/13600/17200) for a complete baseline.

---

## Runbook (owner ops)

**No Docker build, no image registry.** The harness rents a **public** Docker Hub image (`dizcza/docker-hashcat`, hashcat + CUDA, built for vast.ai) and runs the benchmark inline via vast.ai's `onstart` — there is nothing to build or push, and no registry credentials ever touch the rented box.

### 0. Prerequisites (one-time)

A **vast.ai account**. In the console: generate an **API key** (Account → API key).

### 1. Run the benchmark

With your API key in the environment:

```bash
cd packages/gpu-benchmark
VAST_API_KEY=<your-key> pnpm exec tsx src/cli.ts
# add --gpu "RTX 4090" to benchmark just one shortlist shape first, as a cheap smoke test
# add --image <ref> to override the default public image
```

It ranks and rents each shortlist rig cheapest-first, runs `hashcat -b` on it via `onstart`, collects the raw output through vast.ai's logs API, destroys the rig, and writes `docs/research/gpu-recovery/rig-profiles.json`.

**First-run validation (do the cheap single-rig `--gpu "RTX 4090"` run first):**

- Watch that each rig is **destroyed** after its benchmark (check the vast.ai console shows no lingering instances). The code guarantees it, but confirm on the real API.
- Sanity-check the numbers are **non-zero and plausible** (e.g. mode 10500 is in the 10⁷–10⁸ H/s range, mode 9600 in the 10⁴–10⁵ H/s range on a single card).
- If a rig ever comes up as a bad host (a container-runtime error, no benchmark output within the boot budget), confirm the harness moved on to the next-cheapest offer rather than failing the whole shortlist entry.

### 2. Commit the profiles

Once the numbers look right:

```bash
git add docs/research/gpu-recovery/rig-profiles.json
git commit -m "chore(gpu-benchmark): record measured rig profiles"
```

These profiles parameterize the wired GPU recovery rung: they set which rigs the tiered escalation rents, and the `dollarsPerBillionCandidates` ranking picks the best value per mode.

---

## Development

```bash
pnpm --filter @magna-carta/gpu-benchmark test        # unit tests (client, parser, profiles, offer filter, driver, cli)
```

Everything is covered with fakes — the vast.ai client (with API-key redaction), the raw benchmark-log parser, profile ranking, offer selection, and the guaranteed-teardown / bad-GPU-retry driver — since a real run needs a live rented rig.
