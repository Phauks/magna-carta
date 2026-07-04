# @magna-carta/status-worker — CLAUDE.md

**Purpose.** A minimal, read-only, unauthenticated Cloudflare Worker that serves the public service-status feed. It reads the shared `STATUS_KV` namespace, merges the two stored snapshots, and serves them — nothing else. Its entire reason to exist is fate-isolation: it must keep answering "is something out of service?" even when the application Worker, control-plane D1, or a per-firm database is the thing that is down.

**White paper:** _Product updates_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). **Spec:** [`docs/specs/2026-07-02-service-status-design.md`](../../docs/specs/2026-07-02-service-status-design.md).

## Key files / entry points

- `src/index.ts` — the entire Worker: `GET /api/status.json` (the machine-readable feed) and `GET /` (a placeholder page — styled HTML is deferred). Both read `STATUS_KV`, parse the two stored snapshots, and call `mergeSnapshot()` from `@magna-carta/status` with `audience: "public"`.
- `wrangler.jsonc` — the binding set. Read this file before adding anything to it; see "Invariants" below.
- `../worker/src/routes/platform-status.ts` — the sibling write side (a different worker, a different app): the cron that populates `status:derived` and the operator-gated endpoints that populate `status:authored`. This worker never writes either key.
- `../../packages/status/src/` — the shared, pure package both this worker and `apps/worker` import: the snapshot schema, the provider registry/adapter, health derivation, and `mergeSnapshot()`. Any change to merge semantics or the snapshot shape belongs there, not here.

## Local conventions

- This worker has no routes beyond the two above and takes no request body. If a task asks for a third endpoint here, ask whether it is actually a read (belongs here) or a write (belongs in `apps/worker`) before adding it.
- Every response path returns `200` or a `4xx` for a malformed request path — never a `5xx`. A KV read failure or a parse failure falls back to the static `FALLBACK_HTML` in `src/index.ts`, not a thrown error. Keep new code inside the existing `try`/`catch` shape in `fetch`.

## Invariants that apply here

- **This worker must never gain an app, D1, or per-firm binding.** Its fate-isolation from the application Worker is the entire point of its existence — every other binding this worker could plausibly want (a D1 handle, an R2 bucket, a service binding into `apps/worker`) reintroduces exactly the coupling this design exists to avoid. The one binding it may hold is `STATUS_KV` (read-only in practice — this worker never writes to it). Before adding any binding to `wrangler.jsonc`, check whether it is `STATUS_KV`; if it is anything else, stop and reconsider the design instead of wiring it in.
- Reads never leak operator identity: this worker always calls `mergeSnapshot(..., { audience: "public" })`, never `"internal"`. If a future internal view is ever added here (rather than reusing the same public feed from the SPA, which is the current design), it must not default to public audience by accident.

## Dependencies & contracts

- Depends on `@magna-carta/status` for the schema, parsing (`parseDerived`/`parseAuthored`), and `mergeSnapshot`. Depends on nothing else — no other `@magna-carta/*` package, no shared app code from `apps/worker`.
- Nothing depends on this worker at build or runtime except its own deploy and its own route (`status.<domain>`); it is not imported by, and does not import, `apps/worker`.

## Gotchas

- **This is a separate deployable with its own Workers Build — it is deliberately not part of `build-all`** (`vp run build-all` in the repo root `vite.config.ts` is scoped to `@magna-carta/worker` only, the same posture as `apps/scan-worker`/`apps/bundle-worker`/`apps/convert-worker`). Building or deploying it is its own step; do not assume it rides along with the main app's deploy.
- `apps/worker` and this worker share exactly one KV namespace and nothing else. If a change here seems to need data that only `apps/worker` has, that is a sign the data belongs in `STATUS_KV` (written by the cron or the operator routes), not a signal to add a binding.
- The `wrangler.jsonc` `STATUS_KV` id binds the real `Magna_Carta_Status` namespace and MUST stay identical to the `STATUS_KV` id in `apps/worker/wrangler.jsonc` — both this worker (read side) and `apps/worker` (cron/operator write side) bind the one shared namespace. Changing it in one place without the other silently splits the read and write sides.
