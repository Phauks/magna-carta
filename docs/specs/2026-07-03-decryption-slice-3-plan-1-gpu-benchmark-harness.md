# Decryption Slice 3 · Plan 1 — GPU benchmark harness (Rung 3 Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hashcat GPU container image plus a benchmark harness that runs our recovery hash-modes on rented vast.ai rigs and records throughput + price into a committed rig-profiles table — the empirical input that parameterizes Stage 2 (the wired GPU rung).

**Architecture:** A committed Docker image (CUDA + hashcat + our clean-license wordlists/rules + a benchmark entrypoint that emits JSON) is published to a registry vast.ai can pull. A local TypeScript harness (`packages/gpu-benchmark/`, an internal tool package like `@magna-carta/fixtures`) drives the vast.ai REST API — search offers → rent our image → wait ready → collect the benchmark JSON → destroy — and aggregates results into `docs/research/gpu-recovery/rig-profiles.json`. All harness logic (vast.ai client, hashcat-output parser, profiles aggregation, offer filter, driver) is unit-tested with mocks; only image build/publish and the real benchmark run need hardware.

**Tech Stack:** Docker (CUDA base, hashcat), TypeScript + Vitest (harness), zod (schemas), the vast.ai REST API (`/api/v0`).

## Global Constraints

- **Confidentiality keystone:** the benchmark uses public hashcat _example hashes_ only — never a real firm file or hash. The harness and image must contain no firm/matter/client data. (Design §4.)
- **Golden rule 14 (C/C++):** hashcat (C) runs _only inside the container on the rented rig_; no hashcat/C linkage enters the TypeScript harness or any first-party Worker. (Design ADR-FFFF.)
- **Golden rule 12 (full names):** no shorthand — `gpuName` not `gpu`, `dollarsPerHour` not `dph` in our own code (vast.ai's wire field `dph_total` is an external term, kept only at the API boundary).
- **Golden rule 13 (no process-doc refs in source):** no "ADR-N", "slice N", "Stage N" in committed source/tests; explain reasoning inline or cite a file path.
- **vast.ai key is a secret:** read from `VAST_API_KEY` env only; never committed, never logged. The harness redacts it.
- **Clean-license wordlists only** (Design §3): reuse the Rung-1 bundled set (`NCSC-100k` OGL-v3.0 + `best64.rule` MIT) from `containers/recovery/`; no breach lists.
- **Commit discipline:** each task commits only its named files.

---

### Task 1: Rig-profiles schema + aggregation (`packages/gpu-benchmark/src/profiles.ts`)

The committed profiles table and the pure functions that build it. Built first because it defines the shape everything else produces.

**Files:**

- Create: `packages/gpu-benchmark/src/profiles.ts`
- Create: `packages/gpu-benchmark/test/profiles.test.ts`
- Create: `packages/gpu-benchmark/package.json` (name `@magna-carta/gpu-benchmark`, `"private": true`, type module, vitest dep)
- Create: `packages/gpu-benchmark/tsconfig.json` (extends the repo base)
- Create: `docs/research/gpu-recovery/rig-profiles.json` (seed: `{ "generatedAt": null, "profiles": [] }`)

**Interfaces:**

- Produces:
  - `interface ModeThroughput { readonly hashcatMode: number; readonly hashesPerSecond: number }`
  - `interface RigProfile { readonly gpuName: string; readonly gpuCount: number; readonly gpuRamMegabytes: number; readonly dollarsPerHour: number; readonly bootSeconds: number; readonly throughput: ReadonlyArray<ModeThroughput>; readonly measuredAt: string }`
  - `function dollarsPerBillionCandidates(profile: RigProfile, hashcatMode: number): number | null` — `(1e9 / hps) / 3600 * dollarsPerHour`; null if the mode is absent.
  - `function rankByValue(profiles: RigProfile[], hashcatMode: number): RigProfile[]` — ascending `dollarsPerBillionCandidates` (cheapest-per-work first), profiles missing the mode sorted last.
  - `function upsertProfile(table: RigProfile[], next: RigProfile): RigProfile[]` — replace an existing `(gpuName, gpuCount)` entry or append; pure.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  dollarsPerBillionCandidates,
  rankByValue,
  upsertProfile,
  type RigProfile,
} from "../src/profiles.ts";

const rig = (gpuName: string, dollarsPerHour: number, hps: number): RigProfile => ({
  gpuName,
  gpuCount: 1,
  gpuRamMegabytes: 24576,
  dollarsPerHour,
  bootSeconds: 120,
  throughput: [{ hashcatMode: 9600, hashesPerSecond: hps }],
  measuredAt: "2026-07-03T00:00:00Z",
});

describe("profiles", () => {
  it("computes dollars per billion candidates for a mode", () => {
    // 68356 H/s at $0.40/hr: (1e9/68356)/3600*0.40 ≈ $1.626
    expect(dollarsPerBillionCandidates(rig("RTX_4090", 0.4, 68356), 9600)).toBeCloseTo(1.626, 2);
    expect(dollarsPerBillionCandidates(rig("RTX_4090", 0.4, 68356), 10700)).toBeNull();
  });
  it("ranks cheaper-per-work first, missing-mode last", () => {
    const ranked = rankByValue([rig("A", 0.8, 68356), rig("B", 0.4, 68356)], 9600);
    expect(ranked.map((r) => r.gpuName)).toEqual(["B", "A"]);
  });
  it("upserts by (gpuName, gpuCount)", () => {
    const t1 = upsertProfile([], rig("RTX_4090", 0.4, 1000));
    const t2 = upsertProfile(t1, rig("RTX_4090", 0.5, 2000));
    expect(t2).toHaveLength(1);
    expect(t2[0].dollarsPerHour).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @magna-carta/gpu-benchmark test` → FAIL (module not found).
- [ ] **Step 3: Implement `profiles.ts`** with the three pure functions per the interfaces above and the JSDoc explaining `dollarsPerBillionCandidates` is the value metric (throughput ÷ price), not vast.ai's `dlperf`.
- [ ] **Step 4: Run test to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/gpu-benchmark/package.json packages/gpu-benchmark/tsconfig.json packages/gpu-benchmark/src/profiles.ts packages/gpu-benchmark/test/profiles.test.ts docs/research/gpu-recovery/rig-profiles.json
git commit -m "feat(gpu-benchmark): rig-profiles schema + value ranking"
```

---

### Task 2: hashcat benchmark-output parser (`packages/gpu-benchmark/src/bench-parse.ts`)

Parse the container's emitted benchmark JSON _and_ raw hashcat machine-readable lines into `ModeThroughput[]`. The image entrypoint (Task 5) emits a JSON envelope, but we parse defensively so a raw-hashcat fallback also works.

**Files:**

- Create: `packages/gpu-benchmark/src/bench-parse.ts`
- Create: `packages/gpu-benchmark/test/bench-parse.test.ts`

**Interfaces:**

- Consumes: `ModeThroughput` (Task 1).
- Produces:
  - `interface BenchmarkResult { readonly gpuName: string; readonly gpuCount: number; readonly gpuRamMegabytes: number; readonly throughput: ModeThroughput[] }`
  - `function parseBenchmarkJson(raw: string): BenchmarkResult` — parses the entrypoint envelope; throws `BenchmarkParseError` on malformed input (never returns partial).
  - `function sumDeviceSpeeds(machineReadableLine: string): number` — sums the per-device SPEED fields in a hashcat `--machine-readable` line (SPEED tokens are `SPEED <hashes> <ms>` repeated per device); returns total hashes/sec.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { parseBenchmarkJson, sumDeviceSpeeds, BenchmarkParseError } from "../src/bench-parse.ts";

describe("bench-parse", () => {
  it("sums per-device SPEED fields from a machine-readable line", () => {
    // two devices: 1,000,000 + 500,000 H/s
    const line =
      "STATUS 3 SPEED 1000000 1000 500000 1000 EXEC_RUNTIME 1.0 CURKU 0 PROGRESS 1 1 REJECTED 0";
    expect(sumDeviceSpeeds(line)).toBe(1500000);
  });
  it("parses the entrypoint envelope", () => {
    const raw = JSON.stringify({
      gpuName: "RTX_4090",
      gpuCount: 1,
      gpuRamMegabytes: 24576,
      throughput: [{ hashcatMode: 9600, hashesPerSecond: 68356 }],
    });
    expect(parseBenchmarkJson(raw).throughput[0].hashesPerSecond).toBe(68356);
  });
  it("throws on malformed input, never partial", () => {
    expect(() => parseBenchmarkJson("{not json")).toThrow(BenchmarkParseError);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @magna-carta/gpu-benchmark test bench-parse` → FAIL.
- [ ] **Step 3: Implement `bench-parse.ts`** — `sumDeviceSpeeds` tokenizes on whitespace, finds `SPEED`, then reads pairs until the next non-numeric token; `parseBenchmarkJson` zod-parses the envelope and throws `BenchmarkParseError` on failure.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`bench-parse.ts`, `bench-parse.test.ts`): `feat(gpu-benchmark): parse hashcat benchmark output`

---

### Task 3: vast.ai client wrapper (`packages/gpu-benchmark/src/vast-client.ts`)

A typed wrapper over the four vast.ai endpoints we use. Injectable `fetch` for testing; key redacted from all errors.

**Files:**

- Create: `packages/gpu-benchmark/src/vast-client.ts`
- Create: `packages/gpu-benchmark/test/vast-client.test.ts`

**Interfaces:**

- Produces:
  - `interface VastOffer { readonly offerId: number; readonly gpuName: string; readonly gpuCount: number; readonly gpuRamMegabytes: number; readonly dollarsPerHour: number; readonly internetDownMbps: number; readonly reliability: number; readonly verified: boolean }`
  - `function createVastClient(apiKey: string, fetchImpl?: typeof fetch): VastClient`
  - `VastClient.searchOffers(query: Record<string, unknown>): Promise<VastOffer[]>` — `PUT /api/v0/bundles/`, maps wire fields (`dph_total`→`dollarsPerHour`, `inet_down`→`internetDownMbps`, `gpu_ram`→`gpuRamMegabytes`).
  - `VastClient.createInstance(offerId: number, params: { image: string; label: string; onstart: string; diskGb: number }): Promise<{ instanceId: number }>` — `PUT /api/v0/asks/{offerId}/`, returns `new_contract` as `instanceId`.
  - `VastClient.getInstance(instanceId: number): Promise<{ status: string; sshHost: string | null; sshPort: number | null }>` — `GET /api/v0/instances/`, find by id.
  - `VastClient.destroyInstance(instanceId: number): Promise<void>` — `DELETE /api/v0/instances/{instanceId}/`; treats 404 as success (idempotent).

- [ ] **Step 1: Write the failing test** (mock `fetch`)

```typescript
import { describe, it, expect, vi } from "vitest";
import { createVastClient } from "../src/vast-client.ts";

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("vast-client", () => {
  it("maps offer wire fields to full names", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        offers: [
          {
            id: 42,
            gpu_name: "RTX_4090",
            num_gpus: 1,
            gpu_ram: 24576,
            dph_total: 0.4,
            inet_down: 900,
            reliability: 0.99,
            verified: true,
          },
        ],
      }),
    );
    const offers = await createVastClient("KEY", fetchImpl).searchOffers({});
    expect(offers[0]).toMatchObject({
      offerId: 42,
      gpuName: "RTX_4090",
      dollarsPerHour: 0.4,
      internetDownMbps: 900,
    });
  });
  it("returns new_contract as instanceId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ new_contract: 777 }));
    expect(
      await createVastClient("KEY", fetchImpl).createInstance(42, {
        image: "x",
        label: "l",
        onstart: "",
        diskGb: 20,
      }),
    ).toEqual({ instanceId: 777 });
  });
  it("destroyInstance treats 404 as success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(createVastClient("KEY", fetchImpl).destroyInstance(777)).resolves.toBeUndefined();
  });
  it("never includes the api key in a thrown error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(createVastClient("SECRETKEY", fetchImpl).searchOffers({})).rejects.toThrow(
      expect.not.stringContaining("SECRETKEY"),
    );
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `vast-client.ts`** — each method builds the request with `Authorization: Bearer ${apiKey}`, parses with zod, maps to full-name interfaces, and throws a `VastApiError` whose message includes status + endpoint but **never** the key.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`vast-client.ts`, `vast-client.test.ts`): `feat(gpu-benchmark): typed vast.ai client (key-redacted)`

---

### Task 4: Candidate shortlist + offer filter (`packages/gpu-benchmark/src/offer-filter.ts`)

The concrete benchmark shortlist (design §1) and a pure filter/selector over `VastOffer[]` — on real fields, never `dlperf`.

**Files:**

- Create: `packages/gpu-benchmark/src/offer-filter.ts`
- Create: `packages/gpu-benchmark/test/offer-filter.test.ts`

**Interfaces:**

- Consumes: `VastOffer` (Task 3).
- Produces:
  - `const BENCHMARK_SHORTLIST: ReadonlyArray<{ gpuName: string; gpuCount: number }>` — `RTX_4090×1`, `RTX_4090×2`, `RTX_4090×4`, `H100_SXM×1` (the datacenter comparison), `RTX_5090×1`.
  - `function cheapestVerifiedOffer(offers: VastOffer[], want: { gpuName: string; gpuCount: number }, minReliability: number): VastOffer | null` — filters to matching `gpuName`+`gpuCount`, `verified === true`, `reliability >= minReliability`, then picks the lowest `dollarsPerHour`; null if none.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { cheapestVerifiedOffer, BENCHMARK_SHORTLIST } from "../src/offer-filter.ts";
import type { VastOffer } from "../src/vast-client.ts";

const offer = (o: Partial<VastOffer>): VastOffer => ({
  offerId: 1,
  gpuName: "RTX_4090",
  gpuCount: 1,
  gpuRamMegabytes: 24576,
  dollarsPerHour: 0.4,
  internetDownMbps: 900,
  reliability: 0.99,
  verified: true,
  ...o,
});

describe("offer-filter", () => {
  it("shortlist is 4090-centric with a datacenter comparison", () => {
    expect(BENCHMARK_SHORTLIST.some((s) => s.gpuName === "RTX_4090" && s.gpuCount === 1)).toBe(
      true,
    );
    expect(BENCHMARK_SHORTLIST.some((s) => s.gpuName === "H100_SXM")).toBe(true);
  });
  it("picks cheapest verified reliable match", () => {
    const chosen = cheapestVerifiedOffer(
      [
        offer({ offerId: 1, dollarsPerHour: 0.5 }),
        offer({ offerId: 2, dollarsPerHour: 0.3 }),
        offer({ offerId: 3, verified: false, dollarsPerHour: 0.1 }),
      ],
      { gpuName: "RTX_4090", gpuCount: 1 },
      0.95,
    );
    expect(chosen?.offerId).toBe(2);
  });
  it("returns null when nothing matches reliability floor", () => {
    expect(
      cheapestVerifiedOffer(
        [offer({ reliability: 0.5 })],
        { gpuName: "RTX_4090", gpuCount: 1 },
        0.95,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `offer-filter.ts`** — the shortlist const (with a comment: selection uses measured throughput ÷ price, deliberately not vast.ai's `dlperf`, a DL-training score) and the pure selector.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`offer-filter.ts`, `offer-filter.test.ts`): `feat(gpu-benchmark): candidate shortlist + offer selector`

---

### Task 5: The GPU benchmark container image (`containers/recovery-gpu/`)

Our image: CUDA + hashcat + the clean-license wordlists/rules + a benchmark entrypoint that runs the full baseline mode set and emits the `BenchmarkResult` JSON envelope. Committed now, built/published in Task 7. No unit test (needs a GPU); a schema-conformance check guards the entrypoint's output shape.

**Files:**

- Create: `containers/recovery-gpu/Dockerfile`
- Create: `containers/recovery-gpu/bench/run-benchmark.sh`
- Create: `containers/recovery-gpu/bench/sample-output.json` (a hand-authored example emit for the contract test)
- Create: `containers/recovery-gpu/README.md` (build/publish/run notes + license attributions for the bundled wordlists)
- Copy: reuse `containers/recovery/wordlists/` (NCSC-100k, best64.rule) — reference by build-context copy

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# hashcat runs ONLY here, on the rented GPU — never linked into our TypeScript/Rust. (Golden rule 14.)
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends hashcat jq ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/recovery-gpu
COPY containers/recovery/wordlists/ ./wordlists/
COPY containers/recovery-gpu/bench/ ./bench/
ENTRYPOINT ["/opt/recovery-gpu/bench/run-benchmark.sh"]
```

- [ ] **Step 2: Write `run-benchmark.sh`** — for each mode in the full baseline set **`9400 9500 9600 10500 10700 11600 13600 17200`** (the three GPU-band modes 9600/10700/11600 plus the CPU-band modes 9400/9500 older Office, 10500 old PDF, 13600 WinZip-AES, 17200 ZipCrypto — baselined even though they run on Rung-1 CPU in production, per the owner's "measure them all" call), run `hashcat -b -m $mode --machine-readable --quiet` (hashcat's built-in benchmark — the authoritative raw device H/s, and it needs **no hash input**, so there are no example-hash files to author or verify). Parse the `SPEED` field(s) with the same tokenizing rule `sumDeviceSpeeds` uses (sum per-device). Read the GPU name/VRAM from `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader`. Print ONE JSON object matching `BenchmarkResult` (`{ gpuName, gpuCount, gpuRamMegabytes, throughput: [{ hashcatMode, hashesPerSecond }, ...] }`) to stdout — nothing else. The wordlists are baked into the image (used by the production recovery rung, not by this raw benchmark) but no password is ever cracked here, so nothing sensitive is produced or logged. Include the exact `jq` assembly in the script. (The full-pass wall-clock per mode is derivable downstream from H/s × candidate count via `dollarsPerBillionCandidates`, so no separate attack-timing run is needed.)

- [ ] **Step 3: Verify the envelope shape against the parser** — add `packages/gpu-benchmark/test/envelope-contract.test.ts` that feeds a committed `containers/recovery-gpu/bench/sample-output.json` (a hand-authored example emit) through `parseBenchmarkJson` and asserts it yields three modes. Create `sample-output.json` alongside.

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseBenchmarkJson } from "../src/bench-parse.ts";

it("the image's sample output parses into the full baseline mode set", () => {
  const raw = readFileSync(
    new URL("../../../containers/recovery-gpu/bench/sample-output.json", import.meta.url),
    "utf8",
  );
  expect(
    parseBenchmarkJson(raw)
      .throughput.map((t) => t.hashcatMode)
      .sort((a, b) => a - b),
  ).toEqual([9400, 9500, 9600, 10500, 10700, 11600, 13600, 17200]);
});
```

- [ ] **Step 4: Run the contract test** — `pnpm --filter @magna-carta/gpu-benchmark test envelope-contract` → PASS.
- [ ] **Step 5: Commit** (`containers/recovery-gpu/*`, `envelope-contract.test.ts`): `feat(recovery-gpu): hashcat benchmark image + output contract`

---

### Task 6: The benchmark driver (`packages/gpu-benchmark/src/run.ts`)

Orchestrates one rig's benchmark: select offer → rent → poll ready (timeout) → collect the JSON → **always destroy** → return a `RigProfile`. TDD the orchestration + the guaranteed-destroy with a fake client; the SSH/collection transport is injected so it's mockable.

**Files:**

- Create: `packages/gpu-benchmark/src/run.ts`
- Create: `packages/gpu-benchmark/test/run.test.ts`

**Interfaces:**

- Consumes: `VastClient` (Task 3), `cheapestVerifiedOffer` (Task 4), `parseBenchmarkJson` (Task 2), `upsertProfile` (Task 1).
- Produces:
  - `type CollectFn = (instance: { sshHost: string; sshPort: number }) => Promise<string>` — returns the raw benchmark JSON from the booted instance (real impl: SSH + read stdout; injected in tests).
  - `function benchmarkOneRig(deps: { client: VastClient; collect: CollectFn; image: string; want: { gpuName: string; gpuCount: number }; now: () => string }): Promise<RigProfile>` — throws if no offer/boot-timeout, but **destroys the instance in a finally** whenever one was created.

- [ ] **Step 1: Write the failing test** — assert (a) happy path returns a `RigProfile` with throughput + `dollarsPerHour`, and (b) **if `collect` throws, `destroyInstance` is still called** (guaranteed teardown).

```typescript
import { describe, it, expect, vi } from "vitest";
import { benchmarkOneRig } from "../src/run.ts";

function fakeClient(overrides = {}) {
  return {
    searchOffers: vi.fn().mockResolvedValue([
      {
        offerId: 42,
        gpuName: "RTX_4090",
        gpuCount: 1,
        gpuRamMegabytes: 24576,
        dollarsPerHour: 0.4,
        internetDownMbps: 900,
        reliability: 0.99,
        verified: true,
      },
    ]),
    createInstance: vi.fn().mockResolvedValue({ instanceId: 777 }),
    getInstance: vi.fn().mockResolvedValue({ status: "running", sshHost: "h", sshPort: 22 }),
    destroyInstance: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
const envelope = JSON.stringify({
  gpuName: "RTX_4090",
  gpuCount: 1,
  gpuRamMegabytes: 24576,
  throughput: [{ hashcatMode: 9600, hashesPerSecond: 68356 }],
});

describe("benchmarkOneRig", () => {
  it("returns a profile and always destroys on success", async () => {
    const client = fakeClient();
    const p = await benchmarkOneRig({
      client: client as any,
      collect: async () => envelope,
      image: "img",
      want: { gpuName: "RTX_4090", gpuCount: 1 },
      now: () => "2026-07-03T00:00:00Z",
    });
    expect(p.dollarsPerHour).toBe(0.4);
    expect(client.destroyInstance).toHaveBeenCalledWith(777);
  });
  it("destroys the instance even when collection fails", async () => {
    const client = fakeClient();
    await expect(
      benchmarkOneRig({
        client: client as any,
        collect: async () => {
          throw new Error("ssh died");
        },
        image: "img",
        want: { gpuName: "RTX_4090", gpuCount: 1 },
        now: () => "t",
      }),
    ).rejects.toThrow("ssh died");
    expect(client.destroyInstance).toHaveBeenCalledWith(777);
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `run.ts`** — select via `cheapestVerifiedOffer`, `createInstance`, poll `getInstance` until `status==="running"` (bounded attempts; measure `bootSeconds`), `collect`, `parseBenchmarkJson`, assemble the `RigProfile`; wrap create→collect in `try/finally` that `destroyInstance`s any created instance. The real `CollectFn` (SSH) and the CLI entry are added in Task 7 (not unit-tested).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** (`run.ts`, `run.test.ts`): `feat(gpu-benchmark): rig benchmark driver with guaranteed teardown`

---

### Task 7: CLI entry + ops runbook + real benchmark run

Wire the driver into a runnable CLI, document the image publish + run, then execute a real benchmark to populate the profiles. The build/publish/run steps need Docker, a registry, and the vast.ai key — they are **owner ops steps**, marked as such.

**Files:**

- Create: `packages/gpu-benchmark/src/cli.ts` (reads `VAST_API_KEY`, `--image`, iterates `BENCHMARK_SHORTLIST`, writes `rig-profiles.json` via `upsertProfile`; the real `CollectFn` = SSH poll-and-read of the result file)
- Create: `packages/gpu-benchmark/src/ssh-collect.ts` (the real `CollectFn` implementation — isolated so the CLI orchestration stays unit-testable with a fake)
- The runbook README is **controller-authored** (`packages/gpu-benchmark/README.md`, serverless-registry walk-through) — the implementer does not write it.
- Modify: `docs/research/gpu-recovery/rig-profiles.json` (populated by the owner run)

**Result-collection mechanism (the one ops-dependent piece):** rent the instance with an `onstart` that runs the benchmark to a file and keeps the box alive — `/opt/recovery-gpu/bench/run-benchmark.sh > /result.json 2>/benchmark.log; sleep infinity` — so the instance stays SSH-reachable after the benchmark finishes. The `CollectFn` SSHes to `sshHost:sshPort` (from `getInstance`) and polls `cat /result.json` until it parses as valid JSON (bounded retries), then returns it. This whole path is **validated + adjusted at the first real run** (SSH key setup, exact timing, whether the base image needs `sleep infinity` vs vast.ai's ssh runtype keeping it up) — write it best-effort with clear comments, it is not unit-testable here.

- [ ] **Step 1: Implement `cli.ts`** — arg parse (`--image <ref>`, `--gpu <name>` optional single-rig), `createVastClient(process.env.VAST_API_KEY)` (throw a clear error if unset), loop `BENCHMARK_SHORTLIST` (or the single `--gpu`) calling `benchmarkOneRig` with the SSH `CollectFn` and the `onstart` above, `upsertProfile` into the loaded `rig-profiles.json`, write it back with a stamped `generatedAt` (`new Date().toISOString()`). Put the SSH glue in `ssh-collect.ts`.
- [ ] **Step 2: Add a smoke test** — `test/cli.test.ts` asserts `cli.ts` exports `main` and that `main` refuses to run without `VAST_API_KEY` (throws a clear error). Keep the orchestration testable by injecting a fake `CollectFn`/client where practical. Run → PASS.
- [ ] **Step 3: (controller) author the serverless-registry runbook** in `README.md` — the owner chose to self-host the image on a Cloudflare **serverless-registry** (Workers + R2), pulling with **read-only credentials** passed to vast.ai. The runbook is a step-by-step walk-through (deploy the registry, build + push the image via its large-layer helper since CUDA layers exceed the 500 MB Worker limit, mint read-only pull creds, run the CLI, configure vast.ai's private-image auth). Controller-authored because it is verified-ops content + a live walk-through; not an implementer transcription task.
- [ ] **Step 4: Commit the code** (`cli.ts`, `ssh-collect.ts`, `cli.test.ts`): `feat(gpu-benchmark): benchmark CLI + SSH collector`
- [ ] **Step 5 (owner ops, controller-guided): deploy the registry, publish the image, run the benchmark, commit the profiles** — the owner performs the runbook (their Cloudflare account + Docker + the vast.ai key), guided live by the controller; the result-collection path is validated + adjusted against the first real rig here. Commit the populated `docs/research/gpu-recovery/rig-profiles.json`: `chore(gpu-benchmark): record measured rig profiles`. These numbers finalize Stage 2's concrete tiers and offer selection.

---

## Self-Review

**Spec coverage (design §6 Stage 1):** image ✅ (Task 5) · benchmark path emitting throughput ✅ (Tasks 2, 5) · runs our modes 9600/10700/11600 ✅ (Task 5) · records throughput + $/hr → profiles ✅ (Tasks 1, 6) · offer selection on real fields not `dlperf` ✅ (Task 4) · guaranteed teardown even in the benchmark harness ✅ (Task 6) · vast.ai key Worker-/owner-side, redacted ✅ (Task 3) · clean-license wordlists only ✅ (Task 5) · confidentiality (example hashes only) ✅ (Task 5, Global Constraints). Stage 2 (the wired coordinator/backend/routes) is a separate plan, gated on the profiles this plan produces.

**Placeholder scan:** every task has concrete code/commands; the only deferred item is the owner ops run (Task 7 Step 5), explicitly marked as hardware/account-dependent, not a code placeholder.

**Type consistency:** `RigProfile`/`ModeThroughput` (Task 1) consumed unchanged by Tasks 2/6; `VastOffer` (Task 3) consumed by Tasks 4/6; `BenchmarkResult` (Task 2) produced by the image (Task 5) and consumed by Task 6; `benchmarkOneRig`/`CollectFn` (Task 6) used by Task 7. Full-name fields throughout; vast.ai wire names confined to `vast-client.ts`.
