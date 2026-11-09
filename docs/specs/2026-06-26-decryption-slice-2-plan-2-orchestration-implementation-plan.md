# Decryption Slice 2, Plan 2 of 2 — recovery orchestration (coordinator + queue + routes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Rung-1 password recovery callable through the app and fan shards across the container fleet. Plan 1 built the shard-level _muscle_ (`recover_shard`, `split_keyspace`, `recovery_tier`, the `recovery` container, `apps/recovery-worker`). This plan builds the _orchestration_: a `RecoveryJobCoordinator` Durable Object that splits the keyspace and fans one shard message per shard onto a recovery Queue, a consumer that dispatches each shard to `apps/recovery-worker` over a service binding and reports the outcome back, and the button-initiated `recover` / status / `cancel` routes that classify the tier and surface the result — first hit cancels the rest, nothing cracks automatically, and only the extracted hash (never the file) ever enters the job/queue/container.

**Architecture:** A new per-firm-namespaced `RecoveryJobCoordinator` DO (`${firmId}:${jobId}`) holds job state in DO storage (mirrors `BundleBuildCoordinator`/`ConversionJob`), extended with the one thing no existing DO does: **fan-out + aggregation**. On `start` it enqueues N `RecoveryShardMessage`s (one per shard) on the recovery Queue; the consumer dispatches each to `apps/recovery-worker` via the `RECOVERY_SERVICE` binding (addressing a **distinct container instance per shard** — Plan 1 pinned a single instance) and calls `reportShard` back on the DO; the DO aggregates progress and **first-hit-cancels** (the consumer checks job status before dispatching and skips once terminal — Queues cannot delete enqueued messages). Because the Worker's wasm surface exposes only `recoveryTier`/`extractHash`/`verifyGuess` (not `split_keyspace`/`recover_shard`, which are native-only), the coordinator does **not** compute word ranges: it passes `{ shardIndex, shardCount }` and each container self-splits its baked wordlist via `split_keyspace(wordlist_len, shardCount)` — keeping wordlist authority in the container and guaranteeing gap-free coverage.

**Tech Stack:** TypeScript (Cloudflare Workers + Hono + `@hono/zod-openapi`), Cloudflare Durable Objects (SQLite-backed class) + Queues + a Worker-to-Worker service binding, the Plan-1 `@magna-carta/decryption` wasm (`extractHash`/`recoveryTier`), the Plan-1 `recovery` Rust container (`axum`, `split_keyspace`/`recover_shard`), Vitest (`@cloudflare/vitest-pool-workers` / Miniflare).

## Global Constraints

- **Confidentiality keystone (never regress):** the password and any decrypted plaintext must NEVER appear in a response (except the recovered password surfaced once to the authorized requester on `found`), audit record, problem detail, log, or queue message. Only the **extracted hash string** enters the job/queue/container — never the file bytes. `fileSha256` in audits is of the ENCRYPTED input. Audits go through `insertAuditLogStatement` (which invokes `refuseUnredactedMetadata`). (`docs/conventions/invariants.md`; the Slice-1 boundary in `apps/worker/src/routes/files/decryption.ts`.)
- **Button-initiated only.** Recovery runs solely on the explicit `POST /api/v1/decryption/recover` action. Nothing cracks on upload or inspect. There is no background/automatic pass anywhere.
- **No panic / no 500 on untrusted input.** Routes and the container ingest attacker-influenced bytes/hashes/params — malformed → 400, never 500/panic. The container already clamps inverted/oob shard specs; keep that.
- **Full names, no shorthand** (golden rule 12): `RecoveryJobCoordinator`, `recoveryTier`, `shardIndex`, `shardCount`, `candidatesTried` — no `rec`/`wl`/`idx`. The DO class is `RecoveryJobCoordinator` (the Rust crate already owns the name `RecoveryJob` — a struct — so the DO must NOT reuse the bare name).
- **No process-doc references in source** (golden rule 13): explain _why_ inline; no "slice/plan/ADR" citation in `.ts`/`.rs`/config. A forward-looking "the GPU-rung adapter plugs in here" note is allowed.
- **Permission + attestation + audit on every recovery** (Slice-1 boundary): `permission: "tools:decryption"` (already registered; no new permission), per-job `attestation.authorized === true`, redacted audit through the standard pipeline.
- **Contract regen is mandatory** when routes change: `pnpm --filter @magna-carta/worker emit-openapi` (regenerates the committed `apps/worker/openapi/openapi.json` snapshot the openapi-emission + conformance tests diff against) → `pnpm --filter @magna-carta/api-client generate` (regenerates the typed client). New operationIds must be added to the sorted union in `apps/worker/test/conformance.test.ts`.
- **DO deploy rules:** a new DO class must be (a) re-exported from `apps/worker/src/index.ts`, (b) bound in `apps/worker/wrangler.jsonc` `durable_objects`, (c) introduced by a NEW `migrations` tag with `new_sqlite_classes` (never modify an applied tag — current highest is `v2-firm-database`; use `v3-recovery-job`). A declared queue consumer with no exported handler fails the deploy.
- **Gate per task:** Rust → `cd crates && cargo test -p decryption-core` / `cd containers/recovery && cargo test` + `cargo clippy -- -D warnings` + `cargo fmt --check`. TS → `pnpm --filter <pkg> test` for the touched package; the worker Miniflare suites for routes/DO/queue. Commit ONLY the task's named files — NEVER `git add -A` (the tree carries ~3 pre-existing prettier-drifted spec files + gitignored build artifacts; do not stage them). Ignore the ~34 pre-existing worker-suite failures (bundle/conversions/etc. — CI is authoritative); verify only the suites this plan adds/touches.
- **Versions / purity:** pure Rust only (golden rule 14); the container reuses Plan-1's `decryption-core` deps. `enableInternet = false` on the container stays.

---

## File Structure

New home: **`apps/worker/src/recovery/`** (mirrors `apps/worker/src/downloads/` and `apps/worker/src/conversions/`). One responsibility per file:

- `apps/worker/src/recovery/recovery-types.ts` — the shared shapes (job state, shard message, `ShardOutcome`, the DO RPC surface). One home so the DO, consumer, adapter, and routes never drift on field names (mirrors `downloads/bundle-types.ts`).
- `apps/worker/src/recovery/recovery-coordinator.ts` — the `RecoveryJobCoordinator` DO (fan-out + aggregation + first-hit-cancel + alarm).
- `apps/worker/src/recovery/recovery-service-adapter.ts` — the typed, zod-validated fetch over the `RECOVERY_SERVICE` binding to `apps/recovery-worker` (mirrors `files/container-scan-adapter.ts`).
- `apps/worker/src/recovery/recovery-consumer.ts` — the recovery-Queue consumer (dispatch shard → report back → ack/retry; skip once the job is terminal).
- `apps/worker/src/routes/files/recovery.ts` — the `recover` / status / `cancel` routes (new file; keeps `routes/files/decryption.ts` focused on the synchronous inspect/unlock).

Modified:

- `containers/recovery/src/server.rs` (+ its tests + `tests/recover_e2e.sh`) — shard-by-count request contract.
- `apps/recovery-worker/src/{index.ts,forward-recovery.ts}` (+ `test/forward-recovery.test.ts`) — per-shard container instance addressing.
- `apps/worker/src/index.ts` — DO re-export + `queue()` routing.
- `apps/worker/src/app.ts` — `Bindings` (`RECOVERY_JOB`, `RECOVERY_QUEUE`, `RECOVERY_SERVICE`) + `registerRecoveryRoutes` call.
- `apps/worker/wrangler.jsonc` — DO binding + `v3-recovery-job` migration + queue producer/consumer + `RECOVERY_SERVICE` service binding.
- `apps/worker/test/conformance.test.ts` — operationId union.
- `packages/identifiers` — a `recoveryJob` identifier prefix (if not already present).

Interfaces are declared once in Task 1 (Rust contract) and Task 3 (`recovery-types.ts`) and consumed unchanged by later tasks.

---

### Task 1: Container — shard-by-count `/recover-shard` contract

The container is the only place that knows its baked wordlist length, so it (not the Worker) resolves a shard index into a word range. Replace the explicit `wordStart`/`wordEnd` request fields with `shardIndex` + `shardCount`; the handler computes its own range via `split_keyspace(wordlist_len, shardCount)[shardIndex]`.

**Files:**

- Modify: `containers/recovery/src/server.rs`
- Modify: `containers/recovery/tests/*` (the server handler test) and `containers/recovery/tests/recover_e2e.sh` (acceptance script — update its JSON body)

**Interfaces:**

- Consumes: `split_keyspace(word_count, shard_count) -> Vec<ShardSpec>`, `recover_shard(job, words, spec, rules) -> ShardOutcome`, `parse_hash` (all `decryption-core`, Plan 1).
- Produces (HTTP): `POST /recover-shard`, request `{ hash: string, format: string, hashcatMode: number, shardIndex: number, shardCount: number, ruleSet: "best64" | "none" }` → `{ found: string | null, candidatesTried: number }` (camelCase; unchanged response). `GET /ready` unchanged. Out-of-range `shardIndex` (`>= shardCount`) or `shardCount == 0` → 400 (caller error, no panic).

- [ ] **Step 1: write the failing test** — a request with an in-test wordlist and a Plan-1 example hash whose password sits in one shard's range is `found` only when that shard's index is requested; `shardCount == 0` and `shardIndex >= shardCount` → 400. Model on the existing `containers/recovery/tests` harness (axum test client) — reuse its wordlist-fixture + example-hash setup, changing only the request body from `wordStart/wordEnd` to `shardIndex/shardCount`.

```rust
#[tokio::test]
async fn resolves_shard_range_by_index_and_count() {
    // wordlist fixture of N words with the example-hash password at a known index;
    // split into shardCount shards, only the shard covering that index finds it.
    let app = test_app_with_wordlist(&["foo", "hashcat", "bar", "baz"]); // password "hashcat" at idx 1
    let hit = post_recover_shard(&app, json!({
        "hash": OOXML_9600_EXAMPLE_HASH, "format": "ooxml", "hashcatMode": 9600,
        "shardIndex": 0, "shardCount": 2, "ruleSet": "none",
    })).await;
    assert_eq!(hit.status(), 200);
    assert_eq!(body_json(hit).await["found"], json!("hashcat")); // idx 1 is in shard 0 of 2

    let miss = post_recover_shard(&app, json!({
        "hash": OOXML_9600_EXAMPLE_HASH, "format": "ooxml", "hashcatMode": 9600,
        "shardIndex": 1, "shardCount": 2, "ruleSet": "none",
    })).await;
    assert_eq!(body_json(miss).await["found"], json!(null)); // idx 1 word not in shard 1 of 2
}

#[tokio::test]
async fn rejects_out_of_range_shard() {
    let app = test_app_with_wordlist(&["a", "b"]);
    for (index, count) in [(2usize, 2usize), (0, 0)] {
        let resp = post_recover_shard(&app, json!({
            "hash": OOXML_9600_EXAMPLE_HASH, "format": "ooxml", "hashcatMode": 9600,
            "shardIndex": index, "shardCount": count, "ruleSet": "none",
        })).await;
        assert_eq!(resp.status(), 400, "shardIndex {index} of {count} must be 400");
    }
}
```

- [ ] **Step 2: run → fail.** `cd containers/recovery && cargo test`
- [ ] **Step 3: implement.** In `server.rs`: change `RecoverShardRequest` to `{ hash, format, hashcat_mode, shard_index: usize, shard_count: usize, rule_set: String }` (drop `word_start`/`word_end`). In the handler: load the baked wordlist (as today), then `if shard_count == 0 || shard_index >= shard_count { return 400 }`, `let spec = split_keyspace(wordlist_len, shard_count)[shard_index]` (guaranteed non-empty/contiguous by Plan 1), then the existing `recover_shard(&job, &words, &spec, &rules)`. Keep the `ruleSet` parse (`best64`/`none` → 400 otherwise) and the no-panic guarantees.
- [ ] **Step 4: run → pass.** `cargo test` + `cargo clippy -- -D warnings` + `cargo fmt --check`.
- [ ] **Step 5: update the acceptance script** `containers/recovery/tests/recover_e2e.sh` — change its POST body from `wordStart/wordEnd` to `shardIndex/shardCount` (e.g. `"shardIndex": 0, "shardCount": 1` to cover the whole list). Do NOT run it (needs Docker; the pre-push hook runs it when `containers/recovery/**` changed + Docker present).
- [ ] **Step 6: commit** (`server.rs`, the test file, `recover_e2e.sh`): `feat(recovery): shard-by-count /recover-shard contract (container self-splits its wordlist)`

---

### Task 2: Recovery worker — per-shard container instance addressing

Plan 1's `apps/recovery-worker` pins every request to one container instance (`getContainer(env.RECOVERY_ENGINE, "recovery")`). To actually fan shards across the fleet, the instance id must vary per shard. The app worker (Task 4) sets an `X-Recovery-Instance` header; the recovery worker uses it to select the container instance.

**Files:**

- Modify: `apps/recovery-worker/src/forward-recovery.ts`, `apps/recovery-worker/src/index.ts`
- Modify: `apps/recovery-worker/test/forward-recovery.test.ts`

**Interfaces:**

- `routeRequest(request, resolveContainer)` where `resolveContainer(instanceId: string) => Fetcher` — `index.ts` passes `(id) => getContainer(env.RECOVERY_ENGINE, id)`. For `POST /recover-shard`, the instance id is `request.headers.get("X-Recovery-Instance")` (falling back to `"recovery"` when absent, preserving single-instance behavior for any direct/legacy caller). `GET /ready` uses the fixed `"recovery"` instance.

- [ ] **Step 1: write the failing test** — `routeRequest` selects the container instance from the `X-Recovery-Instance` header. Mirror the existing `forward-recovery.test.ts` fake-container pattern; assert the resolver is called with the header value.

```ts
it("routes /recover-shard to the container instance named by X-Recovery-Instance", async () => {
  const seen: string[] = [];
  const resolve = (id: string) => {
    seen.push(id);
    return {
      fetch: async () => new Response('{"found":null,"candidatesTried":3}', { status: 200 }),
    };
  };
  const req = new Request("http://recovery/recover-shard", {
    method: "POST",
    headers: { "X-Recovery-Instance": "job_abc:2" },
    body: "{}",
  });
  const res = await routeRequest(req, resolve);
  expect(res.status).toBe(200);
  expect(seen).toEqual(["job_abc:2"]);
});
```

- [ ] **Step 2: run → fail.** `pnpm --filter @magna-carta/recovery-worker test`
- [ ] **Step 3: implement.** Change `routeRequest(request, container)` → `routeRequest(request, resolveContainer: (id: string) => RecoveryEngineContainerFetcher)`. In the `/recover-shard` branch: `const instanceId = request.headers.get("X-Recovery-Instance") ?? "recovery"; return forwardRecoveryShard(request, resolveContainer(instanceId));`. `/ready` → `forwardReady(resolveContainer("recovery"))`. In `index.ts`: `return routeRequest(request, (id) => getContainer(env.RECOVERY_ENGINE, id));`. Keep the body/`duplex:"half"` passthrough unchanged.
- [ ] **Step 4: run → pass** + `pnpm --filter @magna-carta/recovery-worker exec tsc --noEmit` (or the package's typecheck).
- [ ] **Step 5: commit** (`forward-recovery.ts`, `index.ts`, the test): `feat(recovery): address a distinct container instance per shard (X-Recovery-Instance)`

---

### Task 3: Shared recovery orchestration types (`recovery-types.ts`)

One home for the shapes the DO, consumer, adapter, and routes share (mirrors `downloads/bundle-types.ts`).

**Files:** Create `apps/worker/src/recovery/recovery-types.ts`

**Interfaces (Produces):**

```ts
// The extracted-hash job the coordinator fans out. NEVER carries file bytes or the password.
export type RecoveryTierName = "cfCapable" | "gpuRequired";

export type RecoveryJobStatus =
  | "queued" // shards enqueued, none reported yet
  | "running" // at least one shard reported, none found, not all done
  | "found" // a shard recovered the password (terminal)
  | "exhausted" // every shard reported, none found (terminal)
  | "needsGpu" // slow KDF — not attempted on CF (terminal; the GPU rung fills this seam)
  | "cancelled"; // caller cancelled (terminal)

export interface RecoveryProgress {
  readonly candidatesTried: number; // summed across reported shards
  readonly shardsDone: number; // shards that have reported
  readonly shardCount: number; // total shards fanned out (0 for needsGpu)
}

export interface RecoveryJobState {
  readonly status: RecoveryJobStatus;
  readonly tier: RecoveryTierName;
  readonly progress: RecoveryProgress;
  readonly password: string | null; // set ONLY when status === "found"; surfaced once, never persisted long-term
  readonly error: string | null;
}

// One message per shard on the recovery Queue. Hash string only — never the file.
export interface RecoveryShardMessage {
  readonly firmId: string;
  readonly jobId: string;
  readonly shardIndex: number;
  readonly shardCount: number;
  readonly hash: string;
  readonly format: "pdf" | "zip" | "ooxml";
  readonly hashcatMode: number;
  readonly ruleSet: "best64" | "none";
}

// The container's JSON reply (mirrors the Rust ShardOutcome).
export interface ShardOutcome {
  readonly found: string | null;
  readonly candidatesTried: number;
}

// The parameters the route hands the coordinator to start a job.
export interface RecoveryStartInput {
  readonly tier: RecoveryTierName; // gpuRequired => no shards enqueued, terminal needsGpu
  readonly shardCount: number; // the modest CF shard count (0 for gpuRequired)
  readonly hash: string;
  readonly format: "pdf" | "zip" | "ooxml";
  readonly hashcatMode: number;
  readonly ruleSet: "best64" | "none";
  readonly firmId: string;
  readonly jobId: string;
}

// The DO RPC surface the route + consumer call.
export interface RecoveryCoordinator {
  start(input: RecoveryStartInput): Promise<RecoveryJobState>; // enqueues shardCount messages (or terminal needsGpu)
  reportShard(shardIndex: number, outcome: ShardOutcome): Promise<void>; // aggregate; first found wins
  cancel(): Promise<void>;
  status(): Promise<RecoveryJobState>;
}

// The backend seam — the coordinator is backend-agnostic on purpose. Slice 2 ships ONE
// implementation: the Cloudflare-CPU container backend. The later GPU-rung adapter plugs in here
// with no coordinator rework (same split + first-hit-cancel; only the backend differs). This app
// has no generic fan-out primitive today — recovery is its first fan-out consumer — so the generic
// cross-domain primitive is NOT built here; the next non-recovery domain that needs container
// fan-out extracts it FROM this coordinator rather than rolling its own.
export interface RecoveryBackend {
  recoverShard(message: RecoveryShardMessage): Promise<ShardOutcome>;
}
```

- [ ] **Step 1: create the file** with the block above (types only — no runtime). Add a top-of-file comment stating the confidentiality rule (hash-only, never the file/password in a message).
- [ ] **Step 2: verify it compiles.** `pnpm --filter @magna-carta/worker exec tsc --noEmit` (expect: no errors from this file).
- [ ] **Step 3: commit** (`recovery-types.ts`): `feat(recovery): shared job/shard/outcome types`

---

### Task 4: `RecoveryJobCoordinator` Durable Object

The fan-out + aggregation coordinator. Extends the single-flight pattern of `BundleBuildCoordinator`/`ConversionJob` with what neither does: enqueue N messages and aggregate N reports, first-hit-cancel.

**Files:** Create `apps/worker/src/recovery/recovery-coordinator.ts`

**Interfaces:**

- Consumes: `RecoveryStartInput`, `RecoveryJobState`, `ShardOutcome`, `RecoveryCoordinator` (Task 3); `env.RECOVERY_QUEUE.send(message)` (a `Queue<RecoveryShardMessage>`, wired in Task 8).
- Produces: `export class RecoveryJobCoordinator extends DurableObject<Bindings> implements RecoveryCoordinator`.
- State: a single `ctx.storage` key `"state"` holding `RecoveryJobState` (mirror the precedent — KV-style `get/put`; a per-shard SQL table is unnecessary since only summed counters + shardsDone are needed for first-hit-cancel). A stuck-job alarm mirrors the precedent.

Behavior:

- `start(input)`: if a state already exists, return it (idempotent). If `input.tier === "gpuRequired"` → persist terminal `{ status: "needsGpu", tier, progress: {0,0,0}, password: null, error: null }`, no enqueue, no alarm. Else persist `{ status: "queued", tier, progress: {0,0,shardCount}, password: null, error: null }`, arm the stuck alarm, and enqueue one `RecoveryShardMessage` per `shardIndex in 0..shardCount` via `this.env.RECOVERY_QUEUE.send(...)`.
- `reportShard(shardIndex, outcome)`: load state; if already terminal (`found`/`exhausted`/`needsGpu`/`cancelled`) → return (first hit / cancel wins; late reports are dropped). Else: `candidatesTried += outcome.candidatesTried`, `shardsDone += 1`. If `outcome.found !== null` → terminal `found` + `password`, `deleteAlarm()`. Else if `shardsDone === shardCount` → terminal `exhausted`, `deleteAlarm()`. Else `status: "running"`, persist.
- `cancel()`: if terminal → return; else persist `cancelled`, `deleteAlarm()`.
- `status()`: return persisted state, or a terminal `{ status: "exhausted", ... error: "unknown job" }` default (mirror bundle `status()`).
- `alarm()`: if still `queued`/`running` → `{ ...state, status: "exhausted", error: "recovery timed out" }` (a stuck fan-out fails closed; no partial password is ever fabricated).

- [ ] **Step 1: write the failing tests** — unit-test the DO directly (construct with a fake `DurableObjectState` storage + a fake `env.RECOVERY_QUEUE` capturing sent messages), mirroring how `bundle-coordinator`/`conversion-coordinator` are unit-tested if such a test exists; otherwise drive it through the Miniflare DO in a worker test. Cover: (a) `start` with `shardCount=3` enqueues 3 messages with `shardIndex` 0,1,2 and status `queued`; (b) `start` with `tier=gpuRequired` enqueues 0 and status `needsGpu`; (c) three `reportShard` with no hit → `exhausted`, `candidatesTried` summed, `shardsDone=3`; (d) a `reportShard` with `found` on shard 1 → `found` + password, and a later `reportShard` on shard 2 is ignored (still `found`, password unchanged) — **first-hit-cancel**; (e) `cancel` before completion → `cancelled`, later reports ignored.

```ts
it("fans out shardCount messages and aggregates to exhausted when no shard finds it", async () => {
  const sent: RecoveryShardMessage[] = [];
  const coord = newCoordinator({ send: async (m) => void sent.push(m) });
  const state = await coord.start({
    tier: "cfCapable",
    shardCount: 3,
    hash: H,
    format: "ooxml",
    hashcatMode: 9600,
    ruleSet: "best64",
    firmId: "firm_x",
    jobId: "recoveryJob_1",
  });
  expect(state.status).toBe("queued");
  expect(sent.map((m) => m.shardIndex)).toEqual([0, 1, 2]);

  await coord.reportShard(0, { found: null, candidatesTried: 10 });
  await coord.reportShard(1, { found: null, candidatesTried: 20 });
  const mid = await coord.status();
  expect(mid.status).toBe("running");
  await coord.reportShard(2, { found: null, candidatesTried: 5 });
  const done = await coord.status();
  expect(done.status).toBe("exhausted");
  expect(done.progress).toEqual({ candidatesTried: 35, shardsDone: 3, shardCount: 3 });
});

it("first hit wins and later shard reports are ignored", async () => {
  const coord = newCoordinator({ send: async () => {} });
  await coord.start({ tier: "cfCapable", shardCount: 3 /* … */ });
  await coord.reportShard(1, { found: "hunter2", candidatesTried: 12 });
  await coord.reportShard(2, { found: "other", candidatesTried: 4 });
  const s = await coord.status();
  expect(s.status).toBe("found");
  expect(s.password).toBe("hunter2"); // shard 2's late report cannot overwrite
});

it("gpuRequired start is terminal and enqueues nothing", async () => {
  const sent: RecoveryShardMessage[] = [];
  const coord = newCoordinator({ send: async (m) => void sent.push(m) });
  const state = await coord.start({ tier: "gpuRequired", shardCount: 0 /* … */ });
  expect(state.status).toBe("needsGpu");
  expect(sent).toEqual([]);
});
```

- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement** the DO per the behavior above (mirror `bundle-coordinator.ts` structure: `import { DurableObject } from "cloudflare:workers"`, `import type { Bindings } from "../app.ts"`, `implements RecoveryCoordinator`, a `STUCK_DEADLINE_MS`, `ctx.storage.get/put<RecoveryJobState>("state")`, `setAlarm`/`deleteAlarm`, `override async alarm()`). The `start` enqueue loop: `for (let shardIndex = 0; shardIndex < input.shardCount; shardIndex++) await this.env.RECOVERY_QUEUE.send({ firmId: input.firmId, jobId: input.jobId, shardIndex, shardCount: input.shardCount, hash: input.hash, format: input.format, hashcatMode: input.hashcatMode, ruleSet: input.ruleSet });`.
- [ ] **Step 4: run → pass.**
- [ ] **Step 5: commit** (`recovery-coordinator.ts`, the test): `feat(recovery): RecoveryJobCoordinator DO (fan-out + aggregate + first-hit-cancel)`

---

### Task 5: Cloudflare recovery backend + resolver (`recovery-backend.ts`)

The one `RecoveryBackend` implementation this slice ships — a typed, zod-validated fetch over the `RECOVERY_SERVICE` binding to `apps/recovery-worker` (the scan adapter's shape in `files/container-scan-adapter.ts`, NOT the recovery worker's opaque byte-proxy). Sets the per-shard `X-Recovery-Instance` header so the fleet fans out. A `resolveRecoveryBackend(env)` selects it when the binding is present (mirrors `files/scan-port-binding.ts` `resolveScanPort`) — the backend seam the GPU-rung adapter later plugs into.

**Files:** Create `apps/worker/src/recovery/recovery-backend.ts`

**Interfaces:**

- Consumes: `RecoveryShardMessage`, `ShardOutcome`, `RecoveryBackend` (Task 3).
- Produces:
  - `export function cloudflareRecoveryBackend(service: Fetcher, requestTimeoutMs?: number): RecoveryBackend` — its `recoverShard(message)` builds `new Request("http://recovery/recover-shard", { method: "POST", headers: { "content-type": "application/json", "X-Recovery-Instance": \`${message.jobId}:${message.shardIndex}\` }, body: JSON.stringify({ hash, format, hashcatMode, shardIndex, shardCount, ruleSet }), signal: AbortSignal.timeout(requestTimeoutMs) })`. Throws on non-200; zod-parses the JSON into `ShardOutcome` (an unrecognized body is a fault, never a silent miss).
  - `export function resolveRecoveryBackend(env: Bindings): RecoveryBackend | null` — `env.RECOVERY_SERVICE !== undefined ? cloudflareRecoveryBackend(env.RECOVERY_SERVICE) : null` (null = the service is unbound pre-deploy; the consumer treats null as an honest zero-count miss, never a false hit).

- [ ] **Step 1: write the failing test** — a fake `Fetcher` returns `{ found: "pw", candidatesTried: 42 }`; assert `cloudflareRecoveryBackend(service).recoverShard(message)` (a) sets `X-Recovery-Instance` to `jobId:shardIndex`, (b) POSTs the shard-by-count body, (c) returns the parsed outcome; a non-200 throws; a malformed body throws (zod). Assert `resolveRecoveryBackend({})` returns `null` and `resolveRecoveryBackend({ RECOVERY_SERVICE: fake })` returns a backend.

```ts
it("dispatches a shard with the per-shard instance header and parses the outcome", async () => {
  let captured: Request | undefined;
  const service = {
    fetch: async (r: Request) => {
      captured = r;
      return new Response('{"found":"pw","candidatesTried":42}', { status: 200 });
    },
  } as unknown as Fetcher;
  const outcome = await cloudflareRecoveryBackend(service).recoverShard({
    firmId: "firm_x",
    jobId: "recoveryJob_9",
    shardIndex: 2,
    shardCount: 4,
    hash: "$pdf$...",
    format: "pdf",
    hashcatMode: 10500,
    ruleSet: "best64",
  });
  expect(outcome).toEqual({ found: "pw", candidatesTried: 42 });
  expect(captured!.headers.get("X-Recovery-Instance")).toBe("recoveryJob_9:2");
  expect(await captured!.json()).toMatchObject({ shardIndex: 2, shardCount: 4, ruleSet: "best64" });
});

it("resolves the backend only when the service binding is present", () => {
  expect(resolveRecoveryBackend({} as Bindings)).toBeNull();
  expect(resolveRecoveryBackend({ RECOVERY_SERVICE: {} } as unknown as Bindings)).not.toBeNull();
});
```

- [ ] **Step 2: run → fail. Step 3: implement** (mirror `container-scan-adapter.ts` for the fetch/zod and `scan-port-binding.ts` for the resolver: a `ShardOutcome` zod schema `z.object({ found: z.string().nullable(), candidatesTried: z.number().int() })`, a request-timeout backstop constant, throw on non-200, `schema.parse(await response.json())`). **Step 4: run → pass.**
- [ ] **Step 5: commit** (`recovery-backend.ts`, the test): `feat(recovery): Cloudflare recovery backend + resolver (the backend seam)`

---

### Task 6: Recovery Queue consumer (`recovery-consumer.ts`)

Dispatches each shard to the recovery service and reports the outcome back to the coordinator — and **skips dispatch once the job is terminal** (the first-hit-cancel mechanism: Queues cannot delete enqueued messages, so the consumer checks status first). Mirrors `conversions/conversion-consumer.ts`.

**Files:** Create `apps/worker/src/recovery/recovery-consumer.ts`

**Interfaces:**

- Consumes: `RecoveryShardMessage`, `RecoveryCoordinator`, `RecoveryBackend` (Task 3), `resolveRecoveryBackend` (Task 5), `env.RECOVERY_JOB` (the DO namespace).
- Produces: `export async function recoveryQueue(batch: MessageBatch<RecoveryShardMessage>, env: Bindings, resolveBackend = resolveRecoveryBackend): Promise<void>` (the `resolveBackend` seam lets the test inject a fake backend without a real binding).

Per message: resolve `coordinator = env.RECOVERY_JOB.get(idFromName(\`${firmId}:${jobId}\`))`. If `(await coordinator.status()).status` is terminal (`found`/`exhausted`/`needsGpu`/`cancelled`) → `message.ack()`and continue (skip — a peer shard already won, or the job was cancelled). Else:`const backend = resolveBackend(env)`. If `backend === null`→ the service is unbound (pre-deploy) —`await coordinator.reportShard(shardIndex, { found: null, candidatesTried: 0 })`so the job still terminates as`exhausted`(honest no-engine, never a false hit) and`ack()`. Else `const outcome = await backend.recoverShard(message); await coordinator.reportShard(shardIndex, outcome); message.ack()`. On a thrown transport error → `message.retry()` (the shard is retried; the coordinator's terminal guard makes a duplicate report after a retried-then-succeeded dispatch idempotent — a late report on a done job is dropped).

- [ ] **Step 1: write the failing test** — (a) a message whose job is already `found` is acked WITHOUT calling `dispatch`; (b) a message on a live job dispatches and calls `reportShard` with the outcome; (c) `RECOVERY_SERVICE` unbound reports a zero-count miss and acks. Use a fake coordinator namespace + fake dispatch.

```ts
it("skips dispatch when the job is already terminal (first-hit-cancel)", async () => {
  let dispatched = 0;
  const env = fakeEnv({ jobStatus: "found" });
  const backend = {
    recoverShard: async () => {
      dispatched++;
      return { found: null, candidatesTried: 0 };
    },
  };
  await recoveryQueue(batchOf(shardMessage({ shardIndex: 2 })), env, () => backend);
  expect(dispatched).toBe(0);
  expect(env._acked).toBe(1);
});

it("dispatches a live shard and reports the outcome back", async () => {
  const env = fakeEnv({ jobStatus: "running" });
  const backend = { recoverShard: async () => ({ found: null, candidatesTried: 9 }) };
  await recoveryQueue(batchOf(shardMessage({ shardIndex: 1 })), env, () => backend);
  expect(env._reported).toEqual([{ shardIndex: 1, outcome: { found: null, candidatesTried: 9 } }]);
});
```

- [ ] **Step 2: run → fail. Step 3: implement** (mirror `conversion-consumer.ts`'s batch loop + `coordinatorFor` helper + ack/retry). **Step 4: run → pass.**
- [ ] **Step 5: commit** (`recovery-consumer.ts`, the test): `feat(recovery): recovery queue consumer (dispatch + report; skip when terminal)`

---

### Task 7: Routes — `recover` / status / `cancel` (`routes/files/recovery.ts`)

The button-initiated surface. Mirrors the Slice-1 decryption routes' boundary (permission, attestation, size-cap, base64 decode, wasm, redacted audit) — see `apps/worker/src/routes/files/decryption.ts`.

**Files:** Create `apps/worker/src/routes/files/recovery.ts`

**Interfaces:**

- Consumes: `ensureReady`, `extractHash`, `recoveryTier`, `DecryptionError` (`@magna-carta/decryption`); the wasm module import (copy the `decryption_core_bg.wasm` import + `decryptionWasm` cast from `routes/files/decryption.ts`); `requireChokepointFirmContext`/`requireChokepointUserId`, `chokepointMiddleware`, `defineOpenAPIRoute`, `RouteMeta`, `Problem`/`problemJson`, `commitEffectBatch`, `insertAuditLogStatement`, `newIdentifier`; `env.RECOVERY_JOB`; `RecoveryStartInput`/`RecoveryJobState` (Task 3).
- Produces: `export function registerRecoveryRoutes(app, chokepoint): void` with three operations. A module constant `const RECOVERY_SHARD_COUNT = 4;` (modest real sharding — a few containers — proves the coordinator; the comment states this is the CF-band fan-out width, tunable, not a keyspace bound).

Operations (all `permission: "tools:decryption"`, `surface: "app"`, `authenticated: true`, `resource: "firm"`):

- `decryption.recoverStart` — `POST /api/v1/decryption/recover`, body `{ fileBase64: string, attestation: { authorized: boolean } }` → `{ jobId, tier, status }`. Attestation-false → 400; over size-cap → 400; malformed base64 → 400 (mirror inspect). `await ensureReady(decryptionWasm)`; `extractHash(bytes)` (DecryptionError → 400, no content echo). `const tier = await recoveryTier(format, hashcatMode)`. `const jobId = newIdentifier("recoveryJob")`. `const coordinator = env.RECOVERY_JOB.get(env.RECOVERY_JOB.idFromName(\`${firm.firmId}:${jobId}\`))`. `const state = await coordinator.start({ tier, shardCount: tier === "cfCapable" ? RECOVERY_SHARD_COUNT : 0, hash, format, hashcatMode, ruleSet: "best64", firmId: firm.firmId, jobId })`. **Audit** `decryption.recovery_started`(actor,`fileSha256`of the ENCRYPTED input, format, tier — never the file/hash-secret/password). Return`{ jobId, tier, status: state.status }`(200).`rateLimit: "expensive"`, `idempotency: "optional"`.
- `decryption.recoverStatus` — `GET /api/v1/decryption/recover/{jobId}` → `{ status, tier, progress, result? }`. `coordinator.status()`; on `found` include `result: { password: state.password }` (surfaced once to the authorized requester — their file, they attested); other statuses omit `result`. Audit only on the first observation of a terminal state is optional; keep it simple — no audit on status reads (reads aren't mutations). `resource: "firm"`, not audited, `idempotency: "none"`.
- `decryption.recoverCancel` — `DELETE /api/v1/decryption/recover/{jobId}` → 204. `coordinator.cancel()`. Audit `decryption.recovery_cancelled` (actor, jobId). `audited: true`.

Note the confidentiality invariant: the `recover` audit records tier/format/outcome/counts only; the recovered password is NEVER audited or logged, only returned via the status GET's `result.password`.

- [ ] **Step 1: write the failing route-registration test** — assert the three routes register on a bare app and the metas carry `permission: "tools:decryption"` (a light unit test; the full behavior is the Task 9 e2e). Alternatively fold this into Task 9 and make Step 1 here the meta-shape assertion only.
- [ ] **Step 2: run → fail. Step 3: implement** `registerRecoveryRoutes` (copy the decode/size-cap/attestation/wasm/DecryptionError-mapping helpers from `routes/files/decryption.ts` — factor the shared `decodeBase64`/`sha256Hex` into a small `routes/decryption-shared.ts` if that avoids duplication, else duplicate with a comment; do NOT re-export private internals across a boundary that would couple the files). **Step 4: run → pass.**
- [ ] **Step 5: register** in `apps/worker/src/app.ts`: import `registerRecoveryRoutes`, add `registerRecoveryRoutes(app, chokepoint);` beside `registerDecryptionRoutes(app, chokepoint);`.
- [ ] **Step 6: commit** (`routes/files/recovery.ts`, `app.ts`, any shared helper): `feat(recovery): recover/status/cancel routes (tier router, attestation, redacted audit)`

---

### Task 8: Wiring — bindings, DO export, queue routing, Bindings types

Wire the new DO, queue, and service binding so the runtime can construct them. All four insertion points are net-new (the recon confirmed none exist).

**Files:** Modify `apps/worker/src/index.ts`, `apps/worker/src/app.ts`, `apps/worker/wrangler.jsonc`

**Interfaces:**

- Consumes: `RecoveryJobCoordinator` (Task 4), `recoveryQueue` (Task 6), `RecoveryShardMessage` (Task 3).
- Produces: `env.RECOVERY_JOB` (DO namespace), `env.RECOVERY_QUEUE` (producer), `env.RECOVERY_SERVICE?` (Fetcher) on `Bindings`.

- [ ] **Step 1: `index.ts`** — add `export { RecoveryJobCoordinator } from "./recovery/recovery-coordinator.ts";` beside the other DO re-exports. Add a queue-name const `const RECOVERY_QUEUE = "magna-carta-production-recovery-shard";` and, in `queue(batch, env)`, before the ingest fallthrough: `if (batch.queue === RECOVERY_QUEUE) { return recoveryQueue(batch as MessageBatch<RecoveryShardMessage>, env); }` (import `recoveryQueue` + the type).
- [ ] **Step 2: `app.ts` `Bindings`** — add `RECOVERY_JOB: DurableObjectNamespace<import("./recovery/recovery-coordinator.ts").RecoveryJobCoordinator>;`, `RECOVERY_QUEUE: Queue<import("./recovery/recovery-types.ts").RecoveryShardMessage>;`, and `RECOVERY_SERVICE?: Fetcher;` (optional, beside `SCAN_SERVICE?`/`CONVERT?`).
- [ ] **Step 3: `wrangler.jsonc`** (edit the single deduped stanzas):
  - `durable_objects.bindings` += `{ "name": "RECOVERY_JOB", "class_name": "RecoveryJobCoordinator" }`.
  - `migrations` += a NEW tag (append, never modify): `{ "tag": "v3-recovery-job", "new_sqlite_classes": ["RecoveryJobCoordinator"] }`.
  - `queues.producers` += `{ "binding": "RECOVERY_QUEUE", "queue": "magna-carta-production-recovery-shard" }`.
  - `queues.consumers` += `{ "queue": "magna-carta-production-recovery-shard", "max_concurrency": 4, "dead_letter_queue": "magna-carta-production-recovery-shard-deadletter" }` (concurrency ≈ the shard fan-out width).
  - `services` += `{ "binding": "RECOVERY_SERVICE", "service": "magna-carta-recovery" }`.
- [ ] **Step 4: verify** — `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run` typechecks the config (a DO bound to an unexported class, or a consumer with no handler, fails here). Run `pnpm --filter @magna-carta/worker exec tsc --noEmit` for the Bindings types.
- [ ] **Step 5: commit** (`index.ts`, `app.ts`, `wrangler.jsonc`): `feat(recovery): wire RecoveryJobCoordinator DO + recovery queue + RECOVERY_SERVICE binding`

---

### Task 9: Contract regen + conformance union + Miniflare e2e

Close the contract loop and prove the whole orchestration end-to-end under Miniflare.

**Files:** Modify `apps/worker/test/conformance.test.ts`, the generated `apps/worker/openapi/openapi.json` + `packages/api-client/src/*` (regenerated), create `apps/worker/test/recovery-e2e.test.ts`.

**Interfaces:**

- Consumes: everything above; the DO/queue run in Miniflare; the recovery service is stubbed (bind a fake `RECOVERY_SERVICE` whose `fetch` returns a `ShardOutcome` JSON, or drive the consumer via its `resolveBackend` seam with a fake `RecoveryBackend` — a real container cannot run in the pool).

- [ ] **Step 1: regenerate contracts.** `pnpm --filter @magna-carta/worker emit-openapi` then `pnpm --filter @magna-carta/api-client generate`. Confirm the emitted doc gained `decryption.recoverStart`/`decryption.recoverStatus`/`decryption.recoverCancel`.
- [ ] **Step 2: update the conformance union.** In `apps/worker/test/conformance.test.ts`, insert the three new operationIds into the sorted array in alphabetical position within the `decryption.*` block (`decryption.inspect`, then `decryption.recoverCancel`, `decryption.recoverStart`, `decryption.recoverStatus`, then `decryption.unlock`). Run `pnpm --filter @magna-carta/worker test test/conformance.test.ts test/openapi-emission.test.ts` → green.
- [ ] **Step 3: write the e2e** `apps/worker/test/recovery-e2e.test.ts` — mirror `decryption-e2e.test.ts`'s FirmDatabase-DO harness (`applyControlPlaneMigrations`, `seedFirm`, `firmDatabaseFor(env.FIRM_DATABASE, firmId)` to grant `tools:decryption`, `seedCredentialedUser` + `mirrorMemberWithOwnerRole(userId, name, firmId)` + `signInForSessionCookie`). Cover:
  - **CF-capable happy path:** POST `/recover` with a legacy-RC4 PDF fixture (mode 10500 → `cfCapable`) → 200 `{ jobId, tier: "cfCapable", status: "queued" }`. Drive the queue (the pool runs the consumer against the stubbed service returning a `found` on one shard) → GET `/recover/{jobId}` eventually `{ status: "found", result: { password } }`. Assert the `decryption.recovery_started` audit row exists and contains NO password/hash-secret (redaction).
  - **Slow-band:** POST `/recover` with an OOXML-agile fixture (mode 9600 → `gpuRequired`) → 200 `{ status: "needsGpu" }`, zero shards enqueued.
  - **403** for a member without `tools:decryption`; **400** for `attestation.authorized: false`; **400** for malformed base64.
  - **cancel:** POST `/recover` (cfCapable) → DELETE `/recover/{jobId}` → GET shows `cancelled`.
  - Confirm the recovered password NEVER appears in any audit row (query `audit_log` for `decryption.recovery_*` and assert the password value is absent).
- [ ] **Step 4: run → green.** `pnpm --filter @magna-carta/worker test test/recovery-e2e.test.ts`.
- [ ] **Step 5: commit** (`conformance.test.ts`, `openapi.json`, `packages/api-client/src/*`, `recovery-e2e.test.ts`): `feat(recovery): contract regen + conformance union + orchestration e2e`

---

## Self-Review

**Spec coverage (Slice-2 design §4 coordinator, §6 routes, §7 data model):**

- `RecoveryJobCoordinator` DO = keyspace-split + first-hit-cancel coordinator → Tasks 3–4. ✓ (state machine `queued → running → found | exhausted | needsGpu | cancelled` + progress.)
- Recovery Queue producer + consumer, dispatch to `apps/recovery-worker` via service binding, report back → Tasks 5–6, 8. ✓
- Distinct container instance per shard (Plan-1 carry-forward) → Tasks 1–2, 5 (`X-Recovery-Instance`). ✓
- `recover`/status/`cancel` routes, tier router (CF vs `needsGpu`), per-job attestation, redacted audit, password surfaced once, no file persistence → Task 7. ✓
- OpenAPI + api-client + conformance + Miniflare e2e → Task 9. ✓
- **Constraint the design assumed but Plan-1's wasm surface does not provide:** the coordinator cannot `split_keyspace` in the Worker → resolved by shard-by-count in the container (Tasks 1, 4). Stated, not a gap.

**Placeholder scan:** test bodies elide fixtures with `/* … */` and reference `OOXML_9600_EXAMPLE_HASH` / a legacy-RC4 PDF fixture — the implementer reuses the real hashcat example-hash consts already committed in `crates/decryption-core` tests and the PDF fixture already embedded in `apps/worker/test/decryption-route.test.ts` (`PDF_FIXTURE_BASE64`, RC4-40, mode 10500 → `cfCapable`). No `TODO`s.

**Type consistency:** `RecoveryJobState`/`RecoveryShardMessage`/`ShardOutcome`/`RecoveryStartInput`/`RecoveryCoordinator` are defined once in Task 3 and used unchanged in Tasks 4–9. `recoveryTier` returns `"cfCapable" | "gpuRequired"` (matches `RecoveryTierName`). The container request is `{ hash, format, hashcatMode, shardIndex, shardCount, ruleSet }` in Task 1 and built identically by the adapter in Task 5. The DO class is `RecoveryJobCoordinator` throughout (binding `RECOVERY_JOB`), distinct from the Rust `RecoveryJob` struct.

## Execution Handoff

Plan 2 of 2 for Slice 2. After it lands green, Rung-1 recovery is callable end-to-end (button → tier router → fan-out → first-hit → password). Deferred (unchanged): the GPU rungs (Rung 3 cloud / Rung 2 desktop) plug the `needsGpu` seam into the same coordinator; the platform-generic fan-out primitive is extracted by the next non-recovery domain that needs container fan-out; the Tools-area UI widget (post-0.7). Owner-owed at ship: connect a `magna-carta-recovery` Worker to Workers Builds (build root `apps/recovery-worker`) — the container is inert until then, and until the `RECOVERY_SERVICE` binding resolves the consumer reports honest zero-count misses (jobs terminate `exhausted`, never a false hit).
