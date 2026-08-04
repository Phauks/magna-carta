# Editing (in-app document editing) — CLAUDE.md

**Purpose.** The WOPI host + per-document session coordination for in-app `.docx`/office editing, app-managed versioning, the optimistic offline checkout/check-in + reconciliation flow, and the storage-tiering / idle-checkout sweeps. Boundary: this is the worker-side host + coordination only — the coolwsd editing **container** lives in its own `magna-carta-edit` worker (see the Dependencies section).

**White paper:** _Documents & automation_ / _Delivery model_ — design and rationale live there; do not restate.
**Spec:** [`docs/specs/2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md`](../../../../docs/specs/2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md). **Decisions:** the pending ADRs `collabora-editing-host-topology`, `document-editing-concurrency-reconciliation`, `container-subsystems-extract-to-dedicated-workers`.

## Key files / entry points

- `wopi-token.ts` — the per-firm HMAC-signed access token (mint + verify); `EditTokenClaims`.
- `wopi-guard.ts` — `wopiGuard`: verify the token, resolve the firm DB from the token's `firmId` alone; `assertEditCapability`.
- `wopi-routes.ts` — the pure handlers (CheckFileInfo / GetFile / PutFile / Lock family) + `runWopiCallback` (redacted error mapping).
- `wopi-host.ts` — `registerWopiHostRoutes`: mounts the cookieless `/wopi/files/*` surface and wires the handlers to the guard + the DocumentSession DO + R2.
- `document-session.ts` — the per-document `DocumentSession` Durable Object (participants, lock, working-object meta, the idle-reap alarm, `forceClose`) + the shared `documentSessionStub`.
- `edit-session-route.ts` — the editor-launch (`documents:edit`) + read-only view-session routes; the `capability` in the launch response.
- `checkout-routes.ts` — checkout (offline / opt-in exclusive), check-in, reconcile, and force-release routes.
- `tiering-sweep.ts` / `idle-checkout-sweep.ts` — the daily Standard→IA tiering sweep and the `active→stale→released` idle-checkout sweep (both run on the reconciliation cron in `index.ts`).
- The version model + checkout/reconcile statements live in `@magna-carta/file-manager` (`file-service.ts`, `file-statements.ts`, `checkout-statements.ts`, `queries.ts`), not here.

## Local conventions

- **WOPI handlers are pure** `(claims, deps) → Response`/body; the route layer (`wopi-host.ts`) owns the guard + DO + firm/bucket resolution + `runWopiCallback`. Keep new WOPI behavior in a pure handler + its wiring, not inline in the route.
- **Every object key derives from the verified token** (`claims.fileId`/`claims.versionId`), NEVER the request line. The URL `:fileId` is informational.
- **The DO holds the per-document live state**; the firm-scoped business data (files, versions, checkouts) goes through the file-manager DAL — the DO never reaches another firm's data.

## Invariants that apply here

- **Cookieless token surface off the chokepoint.** `/wopi/*` is a raw route (like `preview-serve`), authenticated by the access token only — never the cookie chokepoint. Firm scope + capability are re-checked on every callback (a firm-A token → 404 on firm-B; a view token cannot PutFile/Lock — server-side, independent of CheckFileInfo's advisory flags).
- **Reading is never blocked.** The view surface works in every `edit_state` (idle/coediting/checked*out); an exclusive lock only makes a second \_edit* launch read-only.
- **Optimistic, never-block concurrency.** Multiple offline copies may be out at once; divergence is resolved by a human (a retained-forever `conflict_pending` copy), never auto-merged, and `current` never regresses to a conflicting copy.
- **The live working copy belongs to one session.** `files/{fileId}/current` is mutable and outlives the session that wrote it (a reap cuts a version, it does not delete the object), so the WOPI file-access handlers serve it only when a session is live, the token was minted for THAT session, and the session recorded the working copy — capability is not the gate. Everyone else reads the immutable version their token names, with no fallback between the two, and `CheckFileInfo` reports metadata for whichever of the two `GetFile` will serve that caller.
- **A token is a capability over ONE version, re-checked every callback.** Both file-access handlers resolve the token's file + named version through the same gate (`resolveTokenContent` in `wopi-routes.ts`) before touching R2, so they always refuse and serve together: a soft-deleted file, a version withdrawn behind the status gate, a version a re-scan flagged, or a version handle naming another file all answer 404 on both. The metadata reported is the TOKEN's version — never the file's current pointer — so a version another writer cuts mid-token cannot make `CheckFileInfo` describe bytes `GetFile` does not serve.
- **One coordinator/container per document** (`idFromName(fileId)`) — never pooled/shared across documents (owner red-flag; ADR `collabora-editing-host-topology`).
- **Errors on the WOPI surface are redacted** through `runWopiCallback` — one `operation.failed` with an `X-MC-Error-Id`, no document bytes or token ever logged.

## Dependencies & contracts

- **The coolwsd container is NOT here.** Per ADR `container-subsystems-extract-to-dedicated-workers`, it lives in a dedicated `magna-carta-edit` worker (no egress, no R2/D1 creds, one per document). The editor (browser iframe) loads it and it calls _back_ into this worker's `/wopi/*` surface — the container is the caller, never invoked from here.
- Calls: `@magna-carta/file-manager` (version model, checkout/reconcile, tiering statements), the `DocumentSession` DO binding, R2 (`env.R2`), and the firm database via `firmDatabaseFor(env.FIRM_DATABASE, firmId)` (`firm-database/firm-database-proxy.ts`).
- The returning check-in routes the `@magna-carta/file-manager` quarantine ingest (`apps/worker/src/files/ingest-consumer.ts`). **Editing consumes that pipeline; it does not reach into it.** The pipeline core (`packages/file-manager/src/ingest-core.ts`) belongs to the ingest area and is edited from there, with its own tests — so a check-in that needs different ingest behaviour is an ingest change made in the ingest area, never a tweak to the core from here. Editing owns the call site and the check-in semantics around it; ingest owns what the pipeline does.

## Gotchas

- **The live container is gated** on the measurement-spike deploy. The editor-launch route returns a per-document cookieless editor origin `https://<documentKey>.<USERCONTENT_DOMAIN>/browser/dist/cool.html?WOPISrc=…` (USERCONTENT_DOMAIN defaults to `magnacartausercontent.com` in code — the dedicated content domain, no deploy var) where `documentKey` is a stable opaque SHA-256 digest of the fileId (co-editors converge; the host leaks no fileId), and the WOPISrc points at the **internal** host `wopi.magna-carta.internal` — coolwsd reaches it via the `magna-carta-edit` container's `outboundByHost` interception → the `APP_WORKER` service binding (no egress). The `magna-carta-edit` worker is **scaffolded** (`apps/magna-carta-edit`; `DocumentEditorContainer` + the interception + per-document Host-label routing). The version-cut-on-reap IS wired (the idle alarm cuts a version from `current` via `commitEditedVersion` before freeing) but is a no-op until the container writes `current` via PutFile — it activates automatically when the container lands. The coolwsd `Dockerfile` (`containers/collabora/`, WOPI host allow-list + single pre-spawn kit) and the cookieless wildcard route (`*.magnacartausercontent.com`, DNS + free wildcard TLS verified) are both done. What still needs the live container: the Workers-Builds deploy of `magna-carta-edit` (no local Docker) and the reconnect-after-sleep check. The `WOPI_HOST` literal MUST stay in sync between this route and the edit worker, and so must the **document-key shape**: `deriveDocumentKey` mints 52 lowercase hex characters, and the edit worker refuses any other Host label (`DOCUMENT_KEY_PATTERN` in `apps/magna-carta-edit/src/document-routing.ts`) rather than booting a container for it — change one and change the other in the same commit.
- **`current` is not separately metered** — only committed versions carry the `storage_meter`. Soft-delete destroys the `current` object with no meter delta.
- **Adding a route regenerates the OpenAPI snapshot** (`pnpm --filter @magna-carta/worker run emit-openapi`) and updates BOTH `conformance.test.ts` (known-ops) and `auth-provisioning-e2e.test.ts`. The `/wopi/*` routes are deliberately non-OpenAPI (raw, like `preview-serve`).
- **Checkout/checkin/force-release/reconcile are `idempotency: "optional"`** — they honor a client `Idempotency-Key` when sent but do not force one (the optimistic model lets many offline copies be out at once, so a key-less retry must not be silently deduped into one). Retry/concurrency safety instead rests on: `version_number` assigned ATOMICALLY inside the INSERT (`insertFileVersionStatement` — no read-then-write race), status-guarded reconcile/release statements (safe to replay), and the version-cut being idempotent by `(fileId, current_sha256)`.
- **Reconcile resolves EVERY `conflict_pending` copy** for the file in one pass (not just the newest), and `keep='incoming'` promotes by cutting the copy FORWARD as a new version (reusing `restoreVersion`) — `current` never regresses. PutFile requires a held WOPI lock; the mutating WOPI callbacks (PutFile/Lock) require the edit token's `sessionId` to match the live DO session (kills replay after reap/rotate).
