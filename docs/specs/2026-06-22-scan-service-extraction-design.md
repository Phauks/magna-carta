# Scan-Service Extraction — Design

**Status:** Design (approved shape, pending spec review) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**Builds on:** the slice 2·1 scan engine (`containers/scan/`, the `ScanContainer` Durable Object, `resolveScanPort`) and the access-triggered re-scan + ad-hoc/matter scan routes already on this branch. **Context:** [`2026-06-22-scan-throughput-decision-and-horizontal-plan.md`](2026-06-22-scan-throughput-decision-and-horizontal-plan.md), operations runbook §11.

---

## Problem

The scan engine lives **inside the main app worker** (`apps/worker`): the `ScanContainer` Durable Object is defined and bound there, and the wrangler `containers`/DO/migration blocks belong to that worker. Three consequences, all now concrete:

1. **Signature refresh bundles with unrelated changes.** The container runs **zero-egress**, so a signature update is an **image rebuild**, which forces a full app-worker redeploy. A routine, ideally-daily security update therefore ships whatever else has landed on `main` — coupling a maintenance task to the app's release.
2. **The activation config can't be committed.** The `containers` block red-lines the local `@cloudflare/vitest-pool-workers` test pool (it cannot run container bindings — workers-sdk#10408), so it has to stay out of version control. That blocks any CI-driven deploy of the engine — which is exactly what automatic signature updates require.
3. **Shared failure + deploy domain.** The component whose entire job is ingesting **hostile files** shares a process, a deploy, and a blast radius with the business app.

## Decision

Extract the engine into its own Cloudflare Worker — **`apps/scan-worker`** (service name `magna-carta-scan`) — that owns the `ScanContainer` Durable Object and exposes a single **internal** `POST /scan`. The app worker reaches it through a **service binding** (`SCAN_SERVICE`).

This is a clean boundary because the **`MalwareScanPort` interface already is the boundary**: `scan(body, meta) -> ScanResult`. Its `ScanContainerFetcher` shape (`{ fetch(Request): Promise<Response> }`) is satisfied by a service binding exactly as it is by a container instance — so the app-side change is a one-line re-point of `resolveScanPort`, with every consumer untouched.

## Why this is the right boundary

- The port abstracts "bytes + metadata in, `ScanResult` out." **Everything firm-scoped stays in the app worker** — the dedup cache (`scan_cache`), verdict recording, the staleness gate, the access trigger, the ad-hoc (`scan.diagnose`) and matter (`scan.matter`) routes. The **scan worker is stateless** — no D1, R2, or Queues — a pure engine.
- So privileged client data and orchestration sit on one side; the untrusted-input engine on the other. That separation is the security win, not just a deploy convenience.

## Architecture

```
app worker (magna-carta)                       scan worker (magna-carta-scan)
  ingest consumer ─┐                              fetch: POST /scan ─┐
  access-rescan    ├─ resolveScanPort             (no public route)  │
  scan.diagnose    │     │                                           ▼
  scan.matter     ─┘     ▼                          getContainer(SCAN_CONTAINER,"scan")
                   remoteScanAdapter(env.SCAN_SERVICE)        │ .fetch(/scan)
                         │  POST /scan?size=&contentType=     ▼
                         └────────── service binding ──► ScanContainer DO
                            (streaming body, duplex:half)   (clamd + yara-x + heuristics,
                                                             enableInternet=false)
                   firm-scoped: scan_cache, verdict          warm-poke cron keeps it resident
                   recording, staleness — ALL here
```

- **App worker** reads the file bytes (R2 object stream, or a request body for `scan.diagnose`) and calls `env.SCAN_SERVICE.fetch("POST /scan?size=&contentType=", body)`, then validates the JSON against the `ScanResult` union (throw on any non-200 / malformed / timeout — unchanged; a fault is a retryable throw, never a silent `clean`). `resolveScanPort` becomes: `env.SCAN_SERVICE !== undefined ? remoteScanAdapter(env.SCAN_SERVICE) : unscannedAdapter`. The existing `containerScanAdapter` body is reused verbatim (it already takes a `{ fetch(Request) }`); only its name and the binding it is handed change.
- **Scan worker** owns the `ScanContainer` DO (moved verbatim) and a fetch handler that forwards `POST /scan` to `getContainer(env.SCAN_CONTAINER, "scan").fetch(...)`. It has **no public routes** — reachable only over the app's service binding. Its scheduled handler runs the warm-poke (keeps one instance + clamd's ~1–2 GiB DB resident).

## What moves, what stays

|                                 |                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Moves to `apps/scan-worker`** | `scan-container.ts` (the `ScanContainer` DO), `scan-warm.ts` (`pokeScanContainer` + the `*/20` cron), the container-call half of `container-scan-adapter.ts`, the wrangler `containers` + `SCAN_CONTAINER` DO binding + the container's `new_sqlite_classes` migration (its own `v1` lineage), the `*/20` warm cron trigger |
| **Stays in `apps/worker`**      | `resolveScanPort` (re-pointed), the `ScanResult` validation + throw-on-fault (now `remoteScanAdapter`), every consumer (ingest consumer, access-rescan, `scan.diagnose`, `scan.matter`), the dedup cache, verdict recording, staleness                                                                                      |
| **App worker LOSES**            | the `containers` block, the `SCAN_CONTAINER` DO binding, the `v2` migration tag, the `getContainer` import, the `*/20` cron                                                                                                                                                                                                 |
| **App worker GAINS**            | a `services: [{ binding: "SCAN_SERVICE", service: "magna-carta-scan" }]` binding                                                                                                                                                                                                                                            |

## Transport

A service binding, **HTTP-shaped** end to end: `POST /scan?size=&contentType=`, streaming request body with the `duplex: "half"` hint, reusing the container's existing HTTP contract. The body streams **app worker → scan worker → container** with no intermediate buffering, preserving the SCAN-transport memory property (verified 0 anonymous RSS) — _provided service bindings stream large bodies_ (see Risk R1).

## Security posture (preserved, and improved)

- `enableInternet = false` on the container is **unchanged** — the running engine still has zero egress. Signature freshness comes from an **image rebuild in CI** (the build has internet; the runtime never does).
- The scan worker has **no public route** — it answers only the app's service binding (internal, in-colo), so it is not internet-exposed.
- **Stronger isolation than today:** a clamd/yara parser exploit is contained to a worker that holds **no D1/R2/firm-data binding** — there is nothing privileged to exfiltrate even before egress is considered.

## Configs and the committable-deploy property

- **Scan-worker wrangler** carries `containers` + the `SCAN_CONTAINER` DO + its migration + the warm cron — and **this config is committed**, because the scan worker has **no `vitest-pool-workers` tests** (its proof is the Rust `cargo test` units + the EICAR Docker e2e, neither of which uses the worker pool). The activation config finally lives in version control, which is what lets CI deploy it.
- **App-worker wrangler** gains the `SCAN_SERVICE` service binding (committed; harmless to declare).
- **Test exclusion (the one subtlety):** the app worker's test pool must **not** bind `SCAN_SERVICE`, so `resolveScanPort` yields `unscannedAdapter` in tests — matching pre-activation production and keeping every scan-path test's `unscanned` expectation. The pool reads bindings from `wrangler.jsonc` via `cloudflareTest({ wrangler: { configPath } })`. Preferred mechanism: a `cloudflareTest` miniflare override that leaves `SCAN_SERVICE` unbound. Fallback if the pool errors on an unresolved service binding: a tiny in-pool stub worker that returns `{"verdict":"unscanned","reason":"no-engine","engineVersion":null}` — same observable result, exercising the remote adapter path. **Decided during the spike (Risk R2).**

## Deploys

- **Scan worker** gets its **own** GitHub Actions workflow: triggered on changes to `apps/scan-worker`/`containers/scan` **and a daily cron**. Each run rebuilds the image (`freshclam` pulls the latest signatures _during the CI build_) and runs a real `wrangler deploy`. Needs `CLOUDFLARE_API_TOKEN` + account id as repo secrets (owner-provided — out of reach for the agent).
- **App worker** keeps its existing CI (dry-run today; a real app-deploy is a separate, unchanged decision). With the container gone, its config and test pool are simpler.
- The **first activation** runs through the scan-worker workflow (`workflow_dispatch`), never the owner's machine.

## Local dev and tests

- No `SCAN_SERVICE`/`SCAN_CONTAINER` locally ⇒ `resolveScanPort` ⇒ `unscannedAdapter` (honest no-engine) — unchanged behavior.
- App-worker tests stay green with **no** container config and `SCAN_SERVICE` excluded from the pool.
- Scan-worker tests: the existing `cargo test` + EICAR Docker e2e, plus a small TS unit test for the `/scan` proxy handler driven by a fake container `Fetcher`.

## Rollout sequence

1. Stand up `apps/scan-worker` (move the container files, its wrangler, the `/scan` handler, the warm cron).
2. Re-point the app worker (`resolveScanPort` → service binding; remove the container files/config; add `SCAN_SERVICE`; drop the `*/20` cron).
3. Resolve the test-exclusion mechanism + the streaming spike (R1, R2).
4. Scan-worker deploy workflow (+ daily cron).
5. Owner adds the secrets; first deploy via `workflow_dispatch`; EICAR smoke via `POST /api/v1/scan/diagnose` against production.
6. Revert the transient `containers` block staged in the app worker's `wrangler.jsonc` (superseded by the scan-worker config).

## Out of scope / fast-follows

- A scheduled signed-update job _inside_ the container (still unnecessary — the CI rebuild is the update path).
- Automating the **app** worker's production deploy (a separate decision, unchanged by this work).
- Step-up re-auth firm setting (unrelated; separately tracked).

## Risks / open questions

**Resolved by spikes (2026-06-22) — see the implementation plan for the full findings:**

- **R1 — streaming through a service binding: LOW risk, doc-confirmed.** Workers stream multi-GB request bodies within the 128 MB limit *as long as the worker forwards the body without reading it* — which the adapter and the `/scan` proxy both do. An empirical streamed-scan check is folded into the plan's wiring task; the 2 GiB resident-memory observation is an activation acceptance check.
- **R2 — corrects this spec's over-claim.** A `SCAN_SERVICE` binding to an *undefined* service makes the workerd test pool refuse to boot (`"no such service is defined"`), so the config tension does **not** fully "dissolve" — the app worker trades an *un-stubbable* container block for a **stubbable** service binding. Mitigation: register a `magna-carta-scan` stub worker in the `cloudflareTest` config returning a no-engine `ScanResult`; the pool then boots and tests observe `unscanned` through the remote path. This is a real improvement (the container block could not be stubbed at all), just not zero-tension.
- **R3 — service binding from the queue-consumer context: LOW.** `env.SCAN_SERVICE` is the same `env` the queue handler receives; confirmed by an integration test.

**Deploy / keys (resolved):** the pipeline is **Cloudflare-native, no GitHub secrets.** Workers Builds builds + deploys the scan worker on push (no API token). The daily signature rebuild is the scan worker's own Cron Trigger POSTing a Workers Builds **Deploy Hook** (a unique URL stored as a Cloudflare Worker secret).
