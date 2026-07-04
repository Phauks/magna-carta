# `@magna-carta/gpu-benchmark`

An internal tool that measures hashcat throughput for our recovery hash-modes on rented [vast.ai](https://vast.ai) GPUs, and records the results into `docs/research/gpu-recovery/rig-profiles.json`. Those measured numbers decide which rigs the production GPU recovery rung rents and how deep it can search.

It is **not** shipped to users and is not part of any Worker. It runs on your machine, drives the vast.ai API, and benchmarks a short list of candidate rigs.

## What it does

For each rig in `BENCHMARK_SHORTLIST` (`offer-filter.ts`): find the cheapest verified offer for that GPU shape → rent it running our benchmark image → wait for boot → SSH-read the benchmark result → **destroy the rig** → record `{ gpuName, gpuCount, dollarsPerHour, throughput per mode, ... }`. The teardown is guaranteed (a rig is destroyed even if a step fails), so a bug cannot leave one billing.

The image measures the full mode set — the GPU-band formats (9600 Office, 10700 PDF R6, 11600 7-Zip) and the CPU-band ones (9400/9500/10500/13600/17200) for a complete baseline.

---

## Runbook (owner ops)

> These steps need **your** accounts and a machine with Docker — this repo's dev environment has none. Do them with the controller guiding live; the result-collection timing and a couple of exact commands are confirmed against the live tools as you go (flagged below).

### 0. Prerequisites (one-time)

- A **vast.ai account**. In the console: generate an **API key** (Account → API key) and add your **SSH public key** (so the benchmark can SSH in to read results).
- **Docker** on your machine (to build + push the image).
- A **Cloudflare account** (for the self-hosted image registry).

### 1. Deploy the Cloudflare image registry (serverless-registry)

vast.ai pulls the image over the standard Docker registry protocol, which plain R2 does not speak — so we run Cloudflare's official [`cloudflare/serverless-registry`](https://github.com/cloudflare/serverless-registry) (a Worker + R2).

```bash
git clone https://github.com/cloudflare/serverless-registry
cd serverless-registry
cp wrangler.example.jsonc wrangler.jsonc          # then edit: set the R2 bucket binding name below
npx wrangler r2 bucket create magna-carta-recovery-gpu-registry
# point the wrangler.jsonc r2_buckets binding at that bucket, then:
npx wrangler deploy
```

Set the registry credentials (serverless-registry refuses all requests without them). **Confirm the exact secret names and the read-only-user mechanism against the cloned repo's README** — it supports username/password and JWT auth; we want one **read-only** credential for vast.ai to pull with, separate from the push credential:

```bash
npx wrangler secret put USERNAME     # push credential (confirm name in the repo README)
npx wrangler secret put PASSWORD
# + configure a read-only pull user per the repo's auth docs — this is the credential we give vast.ai
```

The deploy prints your registry host, e.g. `recovery-gpu-registry.<your-subdomain>.workers.dev`.

### 2. Build the image (on your machine)

Build context is the **repo root** (the Dockerfile COPYs `containers/recovery/wordlists/` and `containers/recovery-gpu/bench/`, both repo-root-relative):

```bash
cd <repo root>
docker build -f containers/recovery-gpu/Dockerfile -t <registry-host>/recovery-gpu:latest .
```

### 3. Push the image to your registry

The CUDA base image has layers over serverless-registry's **500 MB per-layer** `docker push` limit, so use the project's large-layer helper (its `./push` script pushes big layers straight to R2, bypassing the Worker):

```bash
docker login <registry-host>            # with the PUSH credential from step 1
# from the cloned serverless-registry repo, use its push helper for big layers:
#   ./push/ ...  (confirm the exact invocation in the repo's README)
```

If every layer happens to be under 500 MB, a plain `docker push <registry-host>/recovery-gpu:latest` works instead.

### 4. Run the benchmark

Give vast.ai the **read-only** pull credential so it can pull the private image (vast.ai console → account → registry credentials for `<registry-host>`, or per its docs). Then, with your API key in the environment:

```bash
cd packages/gpu-benchmark
VAST_API_KEY=<your-key> pnpm exec tsx src/cli.ts --image <registry-host>/recovery-gpu:latest
# (confirm the exact run command — tsx vs a built dist/cli.js — against package.json when we run it)
# add --gpu RTX_4090 to benchmark just one shortlist shape first, as a cheap smoke test
```

It rents each shortlist rig, runs the benchmark, collects the result over SSH, destroys the rig, and writes `docs/research/gpu-recovery/rig-profiles.json`.

**First-run validation (do the cheap single-rig `--gpu RTX_4090` run first):**
- Watch that each rig is **destroyed** after its benchmark (check the vast.ai console shows no lingering instances). The code guarantees it, but confirm on the real API.
- Sanity-check the numbers are **non-zero and plausible** (e.g. mode 10500 ≈ 10⁸ H/s, mode 9600 ≈ 10⁴–10⁵ H/s on a single 4090). hashcat's benchmark machine-readable field layout can vary slightly by version; if any mode is missing or implausible, inspect a raw `hashcat -b -m <mode> --machine-readable` line on the rig and adjust `containers/recovery-gpu/bench/run-benchmark.sh`.
- The result-collection path (SSH `onstart` → `/result.json` → poll-read) is the one piece written best-effort against assumptions about vast.ai instance behavior — expect to tune the timing / paths here on the first run.

### 5. Commit the profiles

Once the numbers look right:

```bash
git add docs/research/gpu-recovery/rig-profiles.json
git commit -m "chore(gpu-benchmark): record measured rig profiles"
```

These profiles parameterize Stage 2 (the wired GPU recovery rung): they set which rigs the tiered escalation rents, and the `dollarsPerBillionCandidates` ranking picks the best value per mode.

---

## Development

```bash
pnpm --filter @magna-carta/gpu-benchmark test        # unit tests (client, parser, profiles, offer filter, driver, cli)
```

The SSH collector (`ssh-collect.ts`) and the real benchmark run are the only parts not covered by unit tests — they need a live rig. Everything else (vast.ai client with key redaction, benchmark-output parsing, profile ranking, offer selection, the guaranteed-teardown driver) is tested with fakes.
