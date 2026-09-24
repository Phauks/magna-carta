# Slice 2·1 — Plan 3: Async bulk-download build job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Past the live-stream threshold, build a bulk-download ZIP as an R2 artifact in the background — a Durable-Object-coordinated, single-flight, content-addressed build with a short-lived signed URL — instead of streaming it inline on the request.

**Architecture:** The bulk-download route (`apps/worker/src/routes/files/downloads.ts`) resolves a selection to version-pinned clean entries exactly as today. Below the threshold it keeps streaming inline. Above either threshold knob it computes a **manifest hash** (content-addressed over the sorted entry keys), asks a `BundleBuildCoordinator` Durable Object (keyed `firmId:manifestHash`) to build it, and returns `202` with a job handle. The DO is the single-flight coordinator: the first request enqueues a `bundle-build` message and arms a stuck-job alarm; identical concurrent requests share the one build. A `bundle-build` queue consumer streams the R2 object bodies through `client-zip` into a single R2 object at `bundles/<manifestHash>.zip` (the firm's own bucket), then marks the DO ready. The client polls a status endpoint for the signed URL. A native R2 lifecycle rule expires the artifacts. This introduces the **first Durable Object** in the codebase.

**Tech Stack:** TypeScript (ESM, `.ts` imports), Cloudflare Durable Objects (SQLite-backed) + Queues + R2 + R2 lifecycle rules, `client-zip` (already a dependency), Hono + `@hono/zod-openapi`, Vitest + `cloudflare:test`. Builds on `@magna-carta/file-manager`, `apps/worker` downloads route + presigner.

## Global Constraints

- **Full names, no shorthand** (golden rule 12); **no process references in source/tests** (golden rule 13, `pnpm run lint:process-refs`).
- **Version-pinned at request time:** a bundle's entries are the clean current versions resolved when the job is requested; a later upload never changes what a built artifact holds (the existing `resolveZipSelection` contract).
- **Per-firm isolation:** the manifest hash is scoped by firm; the artifact lives in the firm's own bucket; the DO name includes the firm id — no cross-firm dedup or access (golden rule 3).
- **Bulk bytes to R2, never D1; never through the Worker buffered:** the build streams R2→`client-zip`→R2; nothing buffers the whole archive in memory.
- **Quarantine/status gate unchanged:** the build reads only the same status-gated clean current versions the live path reads.
- **`pnpm check` + `pnpm run lint:process-refs` green before every commit.**

---

## File Structure

**Modified `packages/file-manager/`:**

- `src/zip-composition.ts` — add `bundleManifestHash(entries, params)` (pure, content-addressed).
- `src/upload-policy.ts` — `liveMaxFileCountDefinition` (default ~1000), `liveMaxTotalBytesDefinition` (default 2 GiB); the existing `zipAsyncThresholdDefinition` is superseded (keep the key readable for one release, but the route decides on the two new knobs).
- `test/zip-composition.test.ts` — manifest-hash determinism + order-independence tests.

**New `apps/worker/`:**

- `src/downloads/bundle-coordinator.ts` — `BundleBuildCoordinator extends DurableObject` (the state machine + alarm).
- `src/background/downloads/bundle-consumer.ts` — the `bundle-build` queue consumer (R2→zip→R2).
- `src/downloads/bundle-types.ts` — the shared `BundleJobState`, `BundleBuildMessage`, and the DO RPC interface.
- `src/http/routes/files/bundle-status.ts` — `GET /api/v1/downloads/bundles/{manifestHash}`.

**Modified `apps/worker/`:**

- `src/http/routes/files/downloads.ts` — threshold routing to the DO; `202` with the job handle.
- `src/index.ts` — export `BundleBuildCoordinator`; bind the `bundle-build` consumer; register the status route.
- `src/http/app.ts` — add `BUNDLE_COORDINATOR: DurableObjectNamespace` and `BUNDLE_BUILD` queue to `Bindings`.
- `wrangler.jsonc` — the DO binding + `new_sqlite_classes` migration, the `bundle-build` producer + consumer, and (deploy runbook) the `bundles/` lifecycle rule.

---

## The shared types (Task 1 produces; the DO, consumer, and routes consume)

```typescript
// apps/worker/src/downloads/bundle-types.ts
export type BundleJobStatus = "building" | "ready" | "failed";

export interface BundleJobState {
  readonly status: BundleJobStatus;
  readonly manifestHash: string;
  readonly r2Key: string | null; // set when ready
  readonly error: string | null; // set when failed
}

export interface BundleBuildMessage {
  readonly firmId: string;
  readonly bucketName: string;
  readonly manifestHash: string;
  readonly entries: readonly { readonly r2Key: string; readonly path: string }[];
}

// The DO RPC surface the route + consumer call.
export interface BundleCoordinator {
  requestBundle(message: BundleBuildMessage): Promise<BundleJobState>; // single-flight: enqueues on first call
  markReady(r2Key: string): Promise<void>;
  markFailed(error: string): Promise<void>;
  status(): Promise<BundleJobState>;
}
```

---

## Task 1: The manifest hash (content-addressed, order-independent)

**Files:** Modify `packages/file-manager/src/zip-composition.ts`. Test: `packages/file-manager/test/zip-composition.test.ts`.

**Interfaces:**

- Produces: `bundleManifestHash(entries: readonly { r2Key: string; path: string }[]): Promise<string>` — a hex SHA-256 over the **sorted** `r2Key\tpath` lines, so the same selection always hashes the same regardless of resolve order, and any change to the set or paths changes the hash.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/file-manager/test/zip-composition.test.ts (additions)
import { describe, expect, it } from "vitest";
import { bundleManifestHash } from "../src/zip-composition.ts";

describe("bundleManifestHash", () => {
  const a = { r2Key: "files/f1/v1", path: "a.pdf" };
  const b = { r2Key: "files/f2/v1", path: "b.pdf" };
  it("is order-independent", async () => {
    expect(await bundleManifestHash([a, b])).toBe(await bundleManifestHash([b, a]));
  });
  it("changes when an entry changes", async () => {
    expect(await bundleManifestHash([a, b])).not.toBe(
      await bundleManifestHash([a, { ...b, path: "b2.pdf" }]),
    );
  });
  it("is a 64-char hex digest", async () => {
    expect(await bundleManifestHash([a])).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — FAIL (export missing).

- [ ] **Step 3: Implement**

```typescript
export async function bundleManifestHash(
  entries: readonly { r2Key: string; path: string }[],
): Promise<string> {
  const canonical = [...entries]
    .map((entry) => `${entry.r2Key}\t${entry.path}`)
    .sort()
    .join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run (PASS) + commit**

```bash
git add packages/file-manager/src/zip-composition.ts packages/file-manager/test/zip-composition.test.ts
git commit -m "feat(file-manager): content-addressed bundle manifest hash"
```

---

## Task 2: The threshold settings

**Files:** Modify `packages/file-manager/src/upload-policy.ts`. Test: `packages/file-manager/test/upload-policy.test.ts`.

**Interfaces:**

- Produces: `liveMaxFileCountDefinition` (default 1000) and `liveMaxTotalBytesDefinition` (default 2 GiB) + reader helpers. The route hands off to a job when `fileCount > liveMaxFileCount` **or** `totalBytes > liveMaxTotalBytes`.

- [ ] **Step 1: Write the failing test** — assert both defaults.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** the two `FirmSettingDefinition<number>` entries mirroring `zipAsyncThresholdDefinition`'s shape, plus `readLiveMaxFileCount`/`readLiveMaxTotalBytes`. Leave a comment that `zipAsyncThresholdDefinition` is superseded by these two (retryability-driven, not a single byte ceiling).

- [ ] **Step 4: Run (PASS) + commit**

```bash
git add packages/file-manager/src/upload-policy.ts packages/file-manager/test/upload-policy.test.ts
git commit -m "feat(file-manager): live-vs-async bulk-download threshold knobs"
```

---

## Task 3: The `BundleBuildCoordinator` Durable Object

**Files:** Create `apps/worker/src/downloads/bundle-types.ts`, `apps/worker/src/downloads/bundle-coordinator.ts`; modify `apps/worker/src/app.ts` (Bindings), `apps/worker/src/index.ts` (export the class), `apps/worker/wrangler.jsonc` (DO binding + migration). Test: `apps/worker/test/bundle-coordinator.test.ts` (`cloudflare:test` with `runInDurableObject`).

**Interfaces:**

- Consumes: `BundleBuildMessage`, `BundleJobState` (Task 1 types).
- Produces: `BundleBuildCoordinator extends DurableObject` implementing `BundleCoordinator`; state persisted in `this.ctx.storage`; `requestBundle` is single-flight (enqueues the `bundle-build` message + arms a 10-minute stuck alarm only on the first call); `markReady`/`markFailed` set terminal state; `alarm()` fails a build still `building` past its deadline.

- [ ] **Step 1: Write the failing tests** (using `cloudflare:test`'s `runInDurableObject` / a DO test harness):
  - first `requestBundle` → state `building` and enqueues exactly one message (a fake `BUNDLE_BUILD` queue records sends).
  - second identical `requestBundle` before completion → still `building`, **no** second enqueue (single-flight).
  - `markReady("bundles/h.zip")` → `status()` returns `ready` with the key.
  - `alarm()` while still `building` past the deadline → `failed`.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement**

```typescript
// apps/worker/src/downloads/bundle-coordinator.ts
import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import type { BundleBuildMessage, BundleJobState } from "./bundle-types.ts";

const STUCK_DEADLINE_MS = 10 * 60 * 1000;

export class BundleBuildCoordinator extends DurableObject<Bindings> {
  async requestBundle(message: BundleBuildMessage): Promise<BundleJobState> {
    const existing = (await this.ctx.storage.get<BundleJobState>("state")) ?? null;
    if (existing !== null && existing.status !== "failed") return existing;
    const state: BundleJobState = {
      status: "building",
      manifestHash: message.manifestHash,
      r2Key: null,
      error: null,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.env.BUNDLE_BUILD.send(message);
    return state;
  }
  async markReady(r2Key: string): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state === undefined) return;
    await this.ctx.storage.put("state", { ...state, status: "ready", r2Key });
    await this.ctx.storage.deleteAlarm();
  }
  async markFailed(error: string): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state === undefined) return;
    await this.ctx.storage.put("state", { ...state, status: "failed", error });
  }
  async status(): Promise<BundleJobState> {
    return (
      (await this.ctx.storage.get<BundleJobState>("state")) ?? {
        status: "failed",
        manifestHash: "",
        r2Key: null,
        error: "unknown job",
      }
    );
  }
  async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state?.status === "building") {
      await this.ctx.storage.put("state", { ...state, status: "failed", error: "build timed out" });
    }
  }
}
```

Add to `app.ts` `Bindings`: `BUNDLE_COORDINATOR: DurableObjectNamespace<import("./downloads/bundle-coordinator.ts").BundleBuildCoordinator>` and `BUNDLE_BUILD: Queue<BundleBuildMessage>`. Export the class from `index.ts`. Add to `wrangler.jsonc`:

```jsonc
"durable_objects": { "bindings": [
  { "name": "SCAN_CONTAINER", "class_name": "ScanContainer" },          // if Plan 2 landed
  { "name": "BUNDLE_COORDINATOR", "class_name": "BundleBuildCoordinator" }
]},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["BundleBuildCoordinator"] }]
```

(If Plan 2 already added a `migrations` tag `v1`, this DO joins the same tag's `new_sqlite_classes` list, or a new tag `v2` adds it — confirm the migration ledger at build time.)

- [ ] **Step 4: Run (PASS) + commit**

```bash
git add apps/worker/src/downloads/bundle-types.ts apps/worker/src/downloads/bundle-coordinator.ts apps/worker/src/app.ts apps/worker/src/index.ts apps/worker/wrangler.jsonc apps/worker/test/bundle-coordinator.test.ts
git commit -m "feat(worker): BundleBuildCoordinator durable object (single-flight + alarm)"
```

---

## Task 4: The `bundle-build` queue consumer

**Files:** Create `apps/worker/src/downloads/bundle-consumer.ts`; modify `apps/worker/src/index.ts`, `apps/worker/wrangler.jsonc`. Test: `apps/worker/test/bundle-consumer.test.ts`.

**Interfaces:**

- Consumes: `BundleBuildMessage`; the R2 binding; the `BUNDLE_COORDINATOR` namespace.
- Produces: `bundleBuildQueue(batch, env)` — for each message, stream the entries' R2 bodies through `makeZip` into `env.R2.put("bundles/<manifestHash>.zip", zipStream)`, then `markReady`; on throw, `markFailed` and rethrow (queue retry → dead-letter).

- [ ] **Step 1: Write the failing test** — a fake R2 with two objects + a fake coordinator stub; run the consumer on a message; assert `R2.put` is called with `bundles/<hash>.zip` and the coordinator's `markReady` is called with that key. A `put` that throws → `markFailed` called + message retried.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement**

```typescript
// apps/worker/src/downloads/bundle-consumer.ts
import { makeZip } from "client-zip";
import type { Bindings } from "../app.ts";
import type { BundleBuildMessage } from "./bundle-types.ts";

async function buildOne(env: Bindings, message: BundleBuildMessage): Promise<void> {
  const key = `bundles/${message.manifestHash}.zip`;
  async function* inputs() {
    for (const entry of message.entries) {
      const object = await env.R2.get(entry.r2Key);
      if (object === null) continue; // reaped between resolve and build — skip, never abort
      yield { name: entry.path, input: object.body };
    }
  }
  const coordinator = env.BUNDLE_COORDINATOR.get(
    env.BUNDLE_COORDINATOR.idFromName(`${message.firmId}:${message.manifestHash}`),
  );
  try {
    await env.R2.put(key, makeZip(inputs()));
    await coordinator.markReady(key);
  } catch (error) {
    await coordinator.markFailed(error instanceof Error ? error.message : "build failed");
    throw error;
  }
}

export async function bundleBuildQueue(
  batch: MessageBatch<BundleBuildMessage>,
  env: Bindings,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await buildOne(env, message.body);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
```

(Confirm `env.R2.put` accepts an unknown-length `ReadableStream`; if a content-length is required, the escalation is an R2 multipart upload — streaming 5 MiB+ parts — named here as the large-bundle seam alongside the Container escalation.)

Add the `BUNDLE_BUILD` producer + a consumer entry (own dead-letter queue) to `wrangler.jsonc`; route `bundleBuildQueue` by queue name in `index.ts`.

- [ ] **Step 4: Run (PASS) + commit**

```bash
git add apps/worker/src/downloads/bundle-consumer.ts apps/worker/src/index.ts apps/worker/wrangler.jsonc apps/worker/test/bundle-consumer.test.ts
git commit -m "feat(worker): bundle-build queue consumer (R2 -> client-zip -> R2)"
```

---

## Task 5: Threshold routing in the downloads route

**Files:** Modify `apps/worker/src/routes/files/downloads.ts`. Test: `apps/worker/test/downloads.test.ts` (extend).

**Interfaces:**

- Consumes: `bundleManifestHash` (Task 1), `readLiveMaxFileCount`/`readLiveMaxTotalBytes` (Task 2), `BUNDLE_COORDINATOR` (Task 3).
- Produces: when `resolved.fileCount > liveMaxFileCount || resolved.totalBytes > liveMaxTotalBytes`, the route computes the manifest hash, checks R2 for an existing `bundles/<hash>.zip` (HEAD → fresh signed GET, `200` redirect-style payload), else calls `coordinator.requestBundle(...)` and returns **`202`** with `{ jobId: manifestHash, status }`. The existing single-file `302` and small-selection live ZIP paths are unchanged.

- [ ] **Step 1: Write the failing tests**
  - a selection under both thresholds → still streams inline (existing behavior preserved).
  - a selection over `liveMaxFileCount` with no existing artifact → `202` `{ jobId, status: "building" }` and the coordinator was asked to build.
  - a selection whose artifact already exists in R2 → `200` with a fresh signed URL, no new build.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** — after `resolveZipSelection` and the audit row, branch on the thresholds. Build the entry list `{ r2Key, path }` from `resolved.entries`, compute `bundleManifestHash`, `env.R2.head(\`bundles/${hash}.zip\`)`; if present, presign + return `200 { url }`; else `const state = await coordinator.requestBundle({ firmId: firm.firmId, bucketName: firm.bucketName, manifestHash: hash, entries })`and return`c.json({ jobId: hash, status: state.status }, 202)`. Add the `202`/`200`-with-url responses to the OpenAPI `responses` map.

- [ ] **Step 4: Run (PASS) + commit**

```bash
git add apps/worker/src/routes/files/downloads.ts apps/worker/test/downloads.test.ts
git commit -m "feat(worker): route large bulk downloads to the async build job"
```

---

## Task 6: The bundle-status poll endpoint

**Files:** Create `apps/worker/src/routes/files/bundle-status.ts`; modify `apps/worker/src/index.ts`. Test: `apps/worker/test/bundle-status.test.ts`.

**Interfaces:**

- Consumes: `BUNDLE_COORDINATOR`, the presigner.
- Produces: `GET /api/v1/downloads/bundles/{manifestHash}` → `{ status, url? }` — `building`/`failed` carry no URL; `ready` mints a fresh short-TTL signed GET for `bundles/<hash>.zip`. Same chokepoint + `files:organize` permission + firm scoping as the download route; the DO is addressed by `firmId:manifestHash` so one firm can never poll another's job.

- [ ] **Step 1: Write the failing tests** — `building` → `{ status: "building" }`; `ready` → `{ status: "ready", url }` with a presigned URL; a hash for another firm → the DO name differs, so `status()` is the caller-firm's job only (no cross-firm read).

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** the route through `defineOpenAPIRoute` (mirror `downloads.ts`'s meta: app surface, authenticated, `files:organize`, resource matter? — here resource is the job; use `audited: false`, `idempotency: "none"`, `rateLimit: "default"`). Resolve the DO by `idFromName(\`${firm.firmId}:${hash}\`)`, call `status()`, presign when ready.

- [ ] **Step 4: Run (PASS) + commit**

```bash
git add apps/worker/src/routes/files/bundle-status.ts apps/worker/src/index.ts apps/worker/test/bundle-status.test.ts
git commit -m "feat(worker): bundle-status poll endpoint with a fresh signed URL"
```

---

## Task 7: R2 lifecycle rule + ops docs + full gate

**Files:** Modify `docs/conventions/operations.md` (the `bundles/` lifecycle rule runbook), `docs/operating-costs.md` (the near-zero async-download cost line), `apps/worker/CLAUDE.md` (the first-DO note + the bundle flow), `STATUS.md`/`ROADMAP.md`.

**Interfaces:** none (deploy-time + docs).

- [ ] **Step 1:** Document the **R2 lifecycle rule** on the `bundles/` prefix (~7-day object expiration) as a deploy-time runbook step — it is account configuration, not code, like the existing R2-notification + Logpush steps. Note the signed-URL TTL is independent and short (300s).
- [ ] **Step 2:** Run the full gate — `pnpm check`, `pnpm run lint:process-refs`, `pnpm --filter @magna-carta/worker exec vitest run`, `pnpm --filter @magna-carta/file-manager exec vitest run`. All green.
- [ ] **Step 3:** Update `apps/worker/CLAUDE.md` (the codebase's first Durable Object; the request→DO→queue→R2→poll flow), STATUS/ROADMAP (2·1 Plan 3 done).
- [ ] **Step 4: Commit**

```bash
git add docs/conventions/operations.md docs/operating-costs.md apps/worker/CLAUDE.md STATUS.md ROADMAP.md
git commit -m "docs: async bulk-download lifecycle rule, cost, and first-DO notes"
```

---

## Self-Review

**Spec coverage (2·1 design, Part C + cross-cutting):** DO-coordinated single-flight build (Task 3); queue-consumer R2→`client-zip`→R2, Container escalation named as a seam (Task 4); content-addressed per-firm manifest-hash dedup (Tasks 1, 5); two threshold knobs (Task 2); `bundles/` lifecycle TTL + short signed-GET (Task 7); poll-v1 delivery with the Notifications push named as the later seam (Task 6). ✓

**Placeholder scan:** the R2 streaming-`put` vs multipart question (Task 4) is flagged as a build-time confirmation with the multipart fallback named — not a silent assumption. The `migrations` tag interaction with Plan 2's DO (Task 3) is flagged for build-time confirmation. No "TODO"/"handle edge cases".

**Type consistency:** `BundleBuildMessage`/`BundleJobState`/`BundleCoordinator` (Task 1 types) thread through the DO (Task 3), the consumer (Task 4), and both routes (Tasks 5, 6); `bundleManifestHash` (Task 1) is the single key derivation used by the route, the consumer's R2 key, and the status endpoint. The DO name `firmId:manifestHash` is identical in the route, the consumer, and the status endpoint (per-firm isolation).

**Cross-plan ordering:** independent of Plan 2; shares `wrangler.jsonc` `durable_objects`/`migrations` with Plan 2's `ScanContainer`, so whichever lands second appends rather than replaces (flagged in Task 3). Both depend only on the merged slice 1·1 download/upload surface, not on Plan 1.
