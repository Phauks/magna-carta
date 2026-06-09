# `@magna-carta/data-access` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 0·2 package 4 of 4 — how the database is **safely reached**: the idempotency write path (ADR-0063), the transactional outbox write + relay sweep (ADR-0064), and the single-batch effect composition that makes both atomic on D1. Firm-scoping, `protected()`, and audit arrive in later slices (per spec §7).

**Architecture:** D1 has no interactive transactions (`BEGIN` rejected; the feature request is closed-not-planned) — the only atomic primitive is `D1Database.batch()`, whose statements are composed up front. So the write path is: _pre-check_ the idempotency record (fast replay / 409 / 422 without running the handler), _execute_ the handler's effect speculatively (it returns statements + outbox messages + the response, committing nothing), then commit **one batch**: `[INSERT idempotency record (completed, UNIQUE key), …business statements, INSERT outbox rows]`. A concurrent duplicate makes the UNIQUE insert fail, rolling back the **entire** batch — the loser re-reads the record and replays the winner's response. Client-minted identifiers (`@magna-carta/identifiers`) make up-front binding possible. The relay sweep publishes pending outbox rows at-least-once (publish, then mark dispatched), dead-lettering after max attempts.

**Tech Stack:** `@magna-carta/database` (schema), `@magna-carta/identifiers` (handles), hono (catalog, middleware adapter), Web Crypto SHA-256 (fingerprints), `@cloudflare/workers-types` + drizzle-orm as dev-only (D1 types; schema-name sync test). Plain Vitest via `vp test`.

**Spec:** [`2026-06-04-foundational-data-conventions-design.md`](2026-06-04-foundational-data-conventions-design.md) §3 (idempotency), §4 (outbox), §7 (package layout). ADR-0063, ADR-0064, ADR-0071.

## Decided up front (read before coding)

1. **ADR-0063 realized via batch, not interactive transaction (amendment).** The spec's §3.2 flow (`INSERT in_progress` inside the effect's transaction, `UPDATE completed` after) assumed an interactive transaction D1 does not have. The batch realization preserves every guarantee with a simpler state machine: the record is inserted **directly as `completed`, with the captured response, in the same batch as the effect** — so "crash between effect and record" is impossible by construction (one atomic commit), and the UNIQUE key is still the concurrency guard (the losing duplicate's whole batch rolls back). `in_progress` is retained in the schema and the decision logic (a future long-running/external-call path may need it; encountering one still yields 409) but the batch path never writes it. Recorded as an ADR-0063 amendment in the docs task.
2. **Effects are DB-only by construction.** Handlers on this path return statements — they never call external services directly; external effects go through the outbox (the §4.5 chokepoint). This is what makes speculative execution safe: a rolled-back batch leaves no trace.
3. **No JS-side cross-statement references exist in a batch** — every binding is fixed before send. All primary keys are minted client-side via `newIdentifier`. The one SQL-level dependency (outbox `seq`, monotonic per `aggregate_key`) is computed **inside the INSERT** with a `SELECT COALESCE(MAX(seq), -1) + 1` subselect — legal in SQLite VALUES, and consistent because batch statements run sequentially in one transaction.
4. **Raw prepared statements, schema-name-sync-tested.** Statements are built as SQL strings against the table/column names of `@magna-carta/database`'s schemas. drizzle-orm stays a devDependency: a fitness test derives the names from `getTableConfig(idempotencyKey/outbox)` and asserts the SQL constants match — drift fails CI without putting the ORM in the runtime path. (The drizzle query-builder can layer in when entity tables exist.)
5. **UNIQUE-conflict detection is by error message** (`UNIQUE constraint failed: idempotency_key.key` — D1 surfaces SQLite's message). Centralized in one predicate so a D1 wire-format change is a one-line fix.
6. **Relay ordering = publish first, then mark.** A crash between the two republishes on the next sweep — at-least-once, which consumers already must tolerate (dedup on outbox `id`, §4.4). Marking first would risk at-most-once (lost effects) — never acceptable here. Failure increments `attempts`; reaching `maxAttempts` sets `status='failed'` and invokes the dead-letter callback (§4.4).
7. **Sessions API note:** D1's Sessions API is read-replication consistency only (writes still hit the primary; no transaction semantics). The composition functions take the minimal `{ prepare, batch }` surface, which a `D1DatabaseSession` also satisfies — enabling bookmark propagation later without API change.
8. **Deferred from this package (not gaps):** route-registry conformance (§3.3 — every money/trust route `idempotency: 'required'`) and the outbox-chokepoint source scan (§4.5) need real routes/handlers — they land with `apps/worker`'s first mutating route. Queue consumers, the relay Cron/Workflow + DO poke wiring, TTL Cron wiring: same. The TTL **purge function** ships here; its schedule arrives with the worker. `@magna-carta/money` is a declared future dependency (ADR-0071) but nothing in this slice uses it — added when first needed (YAGNI).

## File structure

```
packages/data-access/
  package.json · tsconfig.json · vitest.config.ts
  src/
    canonical.ts                    # canonicalJsonStringify + fingerprintRequest (SHA-256)
    idempotency-decision.ts         # record row type + decideIdempotency (execute/replay/409/422)
    idempotency-statements.ts       # SQL constants + insert/select/purge statement builders
    outbox-statements.ts            # OutboxMessage + insert statement builder (seq subselect)
    effect-batch.ts                 # composeEffectBatch — the ONE place a write batch is assembled
    run-idempotent-effect.ts        # the orchestration: pre-check -> execute -> batch -> conflict replay
    outbox-relay.ts                 # sweepOutbox — publish-then-mark, attempts, dead-letter
    hono-idempotency-middleware.ts  # header/metadata handling + pre-decision short-circuit
  test/
    support/stub-d1.ts              # scriptable D1 stub (prepare/bind/run/all/batch, atomic batches)
    canonical.test.ts · idempotency-decision.test.ts · idempotency-statements.test.ts
    outbox-statements.test.ts · effect-batch.test.ts · run-idempotent-effect.test.ts
    outbox-relay.test.ts · hono-idempotency-middleware.test.ts
    schema-name-sync.test.ts        # fitness: SQL names match @magna-carta/database getTableConfig
```

---

### Task 1: Scaffold

**Files:** Create `packages/data-access/package.json`, `tsconfig.json`, `vitest.config.ts` (all mirror `packages/database`, adjusted):

`package.json` — name `@magna-carta/data-access`; exports map one entry per `src/` module (spelled-out paths as above); scripts `{"test": "vp test run"}`; dependencies `@magna-carta/database: workspace:*`, `@magna-carta/identifiers: workspace:*`, `hono: catalog:`; devDependencies `@cloudflare/workers-types`, `@magna-carta/tsconfig`, `@types/node`, `drizzle-orm`, `vitest` (all `catalog:`/`workspace:*`). `tsconfig.json` and `vitest.config.ts`: copy from `packages/database` (no `*.config.ts` include needed). Run `vp install`; commit `chore(data-access): scaffold @magna-carta/data-access package`.

### Task 2: Canonical JSON + request fingerprint (`src/canonical.ts`)

TDD. Tests: key order does not change the output (`{"a":1,"b":2}` for both orders, nested objects sorted recursively, arrays preserved in order); `fingerprintRequest({method:"POST", path:"/api/payments", body})` returns 64-char lowercase hex, identical for key-reordered bodies, different for different method/path/body; `undefined` body allowed (e.g. DELETE).

```ts
// Canonical form: object keys sorted recursively (arrays keep order). Semantically-identical bodies
// share one fingerprint (ADR-0063) regardless of client key order.
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}
// fingerprint = SHA-256(method + " " + path + "\n" + canonical body). Includes the endpoint, so one
// key reused across endpoints trips the mismatch path (spec §3.1).
export async function fingerprintRequest(request: {
  method: string;
  path: string;
  body: unknown;
}): Promise<string> {
  const text = `${request.method.toUpperCase()} ${request.path}\n${
    request.body === undefined ? "" : canonicalJsonStringify(request.body)
  }`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

Commit `feat(data-access): canonical JSON + request fingerprint`.

### Task 3: Idempotency decision logic (`src/idempotency-decision.ts`)

TDD. The pure §3.2 decision table over an existing record (or none):

```ts
export interface IdempotencyRecordRow {
  readonly key: string;
  readonly fingerprint: string;
  readonly status: "in_progress" | "completed";
  readonly response_code: number | null;
  readonly response_body: string | null;
}
export type IdempotencyDecision =
  | { kind: "execute" } // no record — run the effect
  | { kind: "replay"; responseCode: number; responseBody: string | null } // completed + same fingerprint
  | { kind: "in-progress" } // -> 409 (reserved state; the batch path never writes it)
  | { kind: "fingerprint-mismatch" }; // -> 422 (key reused for a different payload)
export function decideIdempotency(
  record: IdempotencyRecordRow | undefined,
  fingerprint: string,
): IdempotencyDecision { … }
```

Tests: no record → execute; completed+same → replay with stored code/body (a stored **failure** replays too — spec §3.5); in_progress+same → in-progress; any status + different fingerprint → fingerprint-mismatch (mismatch wins over status). Implementation is a straight conditional ladder. Commit `feat(data-access): idempotency decision table`.

### Task 4: Statement builders (`src/idempotency-statements.ts`, `src/outbox-statements.ts`) + schema-name sync

TDD with the stub from `test/support/stub-d1.ts` (Task 5 shows it; write it now — copy the database package's stub shape, extended with `onAll(substring, results)` scripting). Builders take the minimal D1 surface:

```ts
// idempotency-statements.ts
import type { IdempotencyRecordId } from "@magna-carta/identifiers/types";
export interface SqlDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
  };
}
export const IDEMPOTENCY_TABLE = "idempotency_key";
export function selectIdempotencyRecordStatement(database: SqlDatabase, key: string) {
  return database
    .prepare(
      `SELECT key, fingerprint, status, response_code, response_body FROM ${IDEMPOTENCY_TABLE} WHERE key = ?1`,
    )
    .bind(key);
}
export interface CompletedIdempotencyRecord {
  id: IdempotencyRecordId;
  key: string;
  fingerprint: string;
  responseCode: number;
  responseBody: string | null;
  createdAt: string;
}
export function insertCompletedIdempotencyRecordStatement(
  database: SqlDatabase,
  record: CompletedIdempotencyRecord,
) {
  return database
    .prepare(
      `INSERT INTO ${IDEMPOTENCY_TABLE} (id, key, fingerprint, status, response_code, response_body, created_at) VALUES (?1, ?2, ?3, 'completed', ?4, ?5, ?6)`,
    )
    .bind(
      record.id,
      record.key,
      record.fingerprint,
      record.responseCode,
      record.responseBody,
      record.createdAt,
    );
}
export function purgeExpiredIdempotencyRecordsStatement(database: SqlDatabase, olderThan: string) {
  return database.prepare(`DELETE FROM ${IDEMPOTENCY_TABLE} WHERE created_at < ?1`).bind(olderThan);
}
// The UNIQUE(key) conflict is the concurrency guard; centralize its detection (decision #5).
export function isIdempotencyKeyConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${IDEMPOTENCY_TABLE}.key`)
  );
}
```

```ts
// outbox-statements.ts
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { SqlDatabase } from "./idempotency-statements.ts";
export const OUTBOX_TABLE = "outbox";
export interface OutboxMessage {
  readonly topic: string;
  readonly payload: unknown; // ids + non-privileged fields ONLY (ADR-0038) — serialized as canonical JSON
  readonly aggregateKey?: string; // ordering scope; seq assigned in-SQL per aggregate
}
// seq is computed INSIDE the insert (statements can't share JS-side results in a batch): a subselect
// over the same aggregate, sequential within the batch's transaction so multi-message effects get
// consecutive seq values. Unordered messages (no aggregateKey) carry NULL seq.
export function insertOutboxMessageStatement(
  database: SqlDatabase,
  message: OutboxMessage,
  createdAt: string,
) {
  return database
    .prepare(
      `INSERT INTO ${OUTBOX_TABLE} (id, topic, payload, aggregate_key, seq, status, attempts, created_at) VALUES (?1, ?2, ?3, ?4, CASE WHEN ?4 IS NULL THEN NULL ELSE (SELECT COALESCE(MAX(seq), -1) + 1 FROM ${OUTBOX_TABLE} WHERE aggregate_key = ?4) END, 'pending', 0, ?5)`,
    )
    .bind(
      newIdentifier("outbox"),
      message.topic,
      canonicalJsonStringify(message.payload),
      message.aggregateKey ?? null,
      createdAt,
    );
}
```

Tests: SQL + bindings captured by the stub match (id is `obx_`-prefixed, payload canonical-JSON, null aggregate key → NULL seq path); `isIdempotencyKeyConflict` true for the D1-style message, false for other errors. Plus **`test/schema-name-sync.test.ts`**: `getTableConfig(idempotencyKey).name === IDEMPOTENCY_TABLE`, `getTableConfig(outbox).name === OUTBOX_TABLE`, and every column named in the SQL strings exists in the schema's column list (regex-extract identifiers from the SQL constants; assert subset). Commit `feat(data-access): idempotency + outbox statement builders, schema-name sync test`.

### Task 5: Effect batch composition (`src/effect-batch.ts`)

The ONE place a write batch is assembled (the §4.5 chokepoint, structurally):

```ts
export interface BatchDatabase extends SqlDatabase {
  batch(statements: unknown[]): Promise<unknown>;
}
export interface EffectWrite {
  readonly statements: readonly unknown[]; // the handler's prepared business statements
  readonly outboxMessages: readonly OutboxMessage[];
}
// Order: idempotency record FIRST (its UNIQUE conflict aborts before any business write executes),
// then business statements, then outbox rows.
export function composeEffectBatch(
  database: BatchDatabase,
  effect: EffectWrite,
  options: { idempotencyRecord?: CompletedIdempotencyRecord; now: () => string },
): unknown[] { … }
export async function commitEffectBatch(database, effect, options): Promise<void> {
  await database.batch(composeEffectBatch(database, effect, options));
}
```

Tests (stub): one batch; ordering record→business→outbox; no record → business+outbox only; empty everything → no batch call (nothing to commit); stub batch failure propagates with nothing recorded. Commit `feat(data-access): single-batch effect composition (idempotency + writes + outbox)`.

### Task 6: The orchestration (`src/run-idempotent-effect.ts`)

```ts
export type IdempotentEffectResult =
  | { kind: "executed"; responseCode: number; responseBody: string | null }
  | { kind: "replayed"; responseCode: number; responseBody: string | null }
  | { kind: "in-progress" } | { kind: "fingerprint-mismatch" };
export async function runIdempotentEffect(options: {
  database: BatchDatabase;
  key: string | undefined; // undefined = optional route without header: execute, no record
  fingerprint: string;
  effect: () => Promise<{ write: EffectWrite; responseCode: number; responseBody: string | null }>;
  now?: () => string;
  newRecordId?: () => IdempotencyRecordId; // injectable for tests
}): Promise<IdempotentEffectResult> { … }
```

Flow: no key → effect + commit (no record) → executed. With key: pre-check SELECT → decide → short-circuit replay/409/422 without invoking effect; else effect() → commit batch with completed record; on `isIdempotencyKeyConflict` → re-read → decide → return (replay/409/422 — the racing winner's outcome); any other error rethrows.

Tests (stub-scripted): fresh key executes and the batch contains the completed record; pre-check replay short-circuits (effect spy not called, stored failure code 500 replays as-is); pre-check in_progress → in-progress; mismatch → fingerprint-mismatch; **concurrent-duplicate race**: stub fails the first batch with the UNIQUE message and serves the winner's record on re-read → result `replayed` + effect called once + nothing committed by the loser; non-conflict batch error (e.g. "D1_ERROR: no such table") propagates un-swallowed; no key → no idempotency SQL at all. Commit `feat(data-access): runIdempotentEffect — pre-check, speculative effect, conflict replay`.

### Task 7: Outbox relay sweep (`src/outbox-relay.ts`)

```ts
export interface OutboxRow {
  id: string; topic: string; payload: string; aggregate_key: string | null;
  seq: number | null; attempts: number;
}
export async function sweepOutbox(options: {
  database: BatchDatabase;
  publish: (row: OutboxRow) => Promise<void>; // Queues send in production
  deadLetter?: (row: OutboxRow, error: Error) => Promise<void>;
  maxAttempts?: number; // default 5
  batchSize?: number;   // default 100
  now?: () => string;
}): Promise<{ dispatched: number; failed: number; deadLettered: number }> { … }
```

Select `WHERE status='pending' ORDER BY created_at LIMIT ?` ; per row: publish → `UPDATE … SET status='dispatched', dispatched_at=? WHERE id=?`; publish failure → `attempts+1`; if `attempts+1 >= maxAttempts` → `status='failed'` + deadLetter callback, else stays pending for the next sweep. Publish-then-mark (decision #6).

Tests: happy path dispatches all pending and marks them; publish failure leaves the row pending with attempts incremented and later rows still processed (isolation); reaching maxAttempts dead-letters exactly once with the row + error; empty sweep returns zeros without publishing. Commit `feat(data-access): outbox relay sweep — publish-then-mark, attempts, dead-letter`.

### Task 8: Hono idempotency middleware (`src/hono-idempotency-middleware.ts`)

Middleware owns the HTTP boundary; `runIdempotentEffect` owns the commit. Per-route metadata via the factory argument:

```ts
import { createMiddleware } from "hono/factory";
export interface IdempotencyContext { key: string; fingerprint: string }
// Route declares 'required' | 'optional' (spec §3.3). required + missing header -> 400.
// Present header: fingerprint the request, pre-decide, short-circuit replay (replayed status/body,
// Idempotency-Replayed: true header) / 409 / 422; else set context var "idempotency" for the handler
// to pass to runIdempotentEffect.
export function idempotencyMiddleware(options: {
  requirement: "required" | "optional";
  database: BatchDatabase;
}) { … }
```

Implementation notes: read the key from the `Idempotency-Key` header; body via `await context.req.raw.clone().json().catch(() => undefined)`; the middleware's pre-decision reuses `selectIdempotencyRecordStatement` + `decideIdempotency`; 409 body `{ error: "a request with this Idempotency-Key is still in progress" }`, 422 body `{ error: "Idempotency-Key reused with a different request payload" }`. Tests: a tiny `new Hono()` app with one POST route; assert 400 (required, no header), pass-through (optional, no header — handler ran, no idempotency SQL), replay short-circuit (handler NOT invoked; stored 201 body returned; `Idempotency-Replayed: true`), 409 and 422 from scripted records, and the execute path exposes `{key, fingerprint}` to the handler via `context.get("idempotency")`. Commit `feat(data-access): hono idempotency middleware — header/metadata boundary + pre-decision`.

### Task 9: Docs + gate

`vp test` + `pnpm check` green. CHANGELOG `[Unreleased]` Added entry (package 4 of 4 — slice 0·2 complete); ROADMAP: slice 0·2 done, Now → next Phase-0 item; Decision-Log: ADR-0063 amendment line (batch realization, decision #1 above) and ADR-0064 note (relay floor shipped as library; Cron wiring pending). Commit `docs(data-access): roadmap + changelog; ADR-0063 batch-realization amendment`.

## Self-review notes (spec coverage)

- §3.1 table: lives in `database` (already shipped); this package writes/reads it. §3.2 flow: Tasks 3+6 (batch realization per decision #1). §3.3: middleware takes the declaration per route (Task 8); registry-wide conformance deferred to worker routes. §3.4 TTL: purge statement (Task 4), Cron deferred. §3.5: stored failures replay (Tasks 3/6 tests); canonicalization (Task 2); fingerprint-is-hash + redaction discipline is the caller's response-capture responsibility (documented in Task 4's comments).
- §4.1 table: in `database`. §4.2 same-transaction write: Task 5 (one batch). §4.3 relay floor: Task 7 (Cron-Workflow + DO poke = worker wiring, deferred per spec "ship the sweep first"). §4.4 consumers: deferred with Queues wiring; dedup key (outbox id) and seq skip-stale documented on `OutboxRow`. §4.5 chokepoint: structurally `composeEffectBatch` is the one assembly point; the CI source-scan fitness lands with real handlers. §4.6 sagas: explicitly YAGNI-deferred (spec).
- §6 test plan rows "Idempotency" and "Outbox": every listed case maps to a Task 6/7 test except crash-consistency, which is by construction (single batch) and asserted via the rolled-back-batch race test.
