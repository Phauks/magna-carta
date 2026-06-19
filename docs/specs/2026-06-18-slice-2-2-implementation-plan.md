# Slice 2·2 — Editing + versioning & storage tiering — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship in-app `.docx` editing (Collabora on Cloudflare Containers) with app-managed versioning, Standard→IA tiering, and an optimistic never-block concurrency model with human reconciliation — backend + worker surface, on the slice 1·1 File Manager substrate.

**Architecture:** One isolated coolwsd container per open document, coordinated by a per-document `DocumentSession` Durable Object (durable state in `ctx.storage` SQLite). The Worker is the client-agnostic WOPI host (standard `X-WOPI-*` baseline, Collabora `X-COOL-*` additive); WOPI callbacks are a token-guarded surface off the cookie chokepoint, with firm-scope + capability re-checked at use. A mutable `current` R2 object is the live working copy; deliberate Saves cut immutable versions via server-side `CopyObject`. Offline edits go out as presigned downloads and return through the ADR-0081 quarantine ingest, reconciled by humans on divergence.

**Tech Stack:** TypeScript · Cloudflare Workers + Hono + `@hono/zod-openapi` · Durable Objects + Containers (`@cloudflare/containers`) · R2 (`aws4fetch` SigV4) · D1 + Drizzle · Collabora Online (coolwsd, WOPI) · `@magna-carta/access-control`, `@magna-carta/database`, `@magna-carta/file-manager`, `@magna-carta/telemetry`, `@magna-carta/data-access`.

**Spec:** [`2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md`](2026-06-18-slice-2-2-editing-versioning-storage-tiering-design.md). **Pending ADRs:** `ADR-collabora-editing-host-topology`, `ADR-document-editing-concurrency-reconciliation`; amends ADR-0035.

## Global Constraints

- **No pooling.** One isolated coolwsd container per document; never a shared coolwsd across documents (spec §2; owner red-flag). Enforced by a source-scan fitness function.
- **Reading is never blocked** in any document state; **no work is ever silently lost or merged** (every merge human-reviewed); these are spec §7 invariants every concurrency task preserves.
- **Tenancy at use:** every WOPI callback re-derives the R2 key + firm DB/bucket binding from the verified token, not the request path; cross-firm/mismatched → **404** (ADR-0052). **Capability** (`edit` vs `view`) is enforced **server-side**, not via CheckFileInfo flags.
- **Bulk client I/O is presigned, direct-to-R2** (ADR-0081/0082); host-received bytes are only the small WOPI `PutFile`. Untrusted returning bytes (check-in) route the **`files-ingest` quarantine pipeline**.
- **Golden rule 4:** every error through `@magna-carta/telemetry` with `cor_`/`err_` IDs, redact-by-default; **never log document bytes or the `access_token`**.
- **Golden rule 10:** no heavy work on the request hot path; stream, don't buffer; offload to the container/DO.
- **Golden rule 11:** verify **current** Collabora SDK + Cloudflare Containers/DO/R2 docs before writing any integration code — never older idioms from memory.
- **Golden rule 13:** no process-doc references (ADR-NNNN, "spec §N", "slice 2·2") in source/tests/OpenAPI strings; state reasoning inline or cite a `docs/conventions/` path. Forward-looking schedule refs are the only exception.
- **Migrations** are numbered at integration time (next free after the per-firm head at merge), expand-contract-safe with safe defaults (ADR-0065); enums get CHECK constraints.
- **OpenAPI code-as-contract** (ADR-0066): session routes via `defineOpenAPIRoute` into the committed snapshot; WOPI routes declared token-guarded in the conformance `PUBLIC_ALLOW_LIST`.
- **All business data through the firm-scoped data-access layer** (golden rule 3); bulk content to R2, never D1.
- **No emojis** anywhere; full names, no shorthand (golden rule 12).
- **Docs are definition-of-done** (golden rule 5): `changelog.d/` fragment + ROADMAP + STATUS + white-paper editing/versioning update in the build commit; user docs deferred to the UI fast-follow (stated explicitly).

---

## Phase 0 — De-risking spike (gates the build; parameterizes later tasks)

### Task 0: Collabora-on-Containers measurement spike

**Files:**
- Create: `containers/collabora/Dockerfile` (throwaway-grade; promoted in Task 4)
- Create: `spikes/collabora-topology/README.md` (records the three numbers + go/no-go)

**Deliverable:** measured values that parameterize Tasks 4, 17, 19 — not red-green TDD.

- [ ] **Step 1:** Verify current docs (golden rule 11): Cloudflare Containers (`@cloudflare/containers`, `min_instances`, `sleepAfter`, `renewActivityTimeout`, instance types, the #147/#162 activity-timeout issues) and Collabora coolwsd container setup (`coolwsd.xml`, `storage.wopi`, `/hosting/discovery`, jail/CAP requirements).
- [ ] **Step 2:** Build a minimal `collabora/code` container image and a one-route Worker+DO that spawns it and serves a static `/hosting/discovery` round-trip.
- [ ] **Step 3:** Measure and record in the README: (1) coolwsd RSS — idle baseline, +1 doc, +Nth doc, a heavy doc; (2) cold-start latency request → discovery-ready → first `.docx` open (incl. image pull); (3) that an **alarm-driven** keep-alive (`renewActivityTimeout` + periodic ping) keeps a busy editing session alive past `sleepAfter`.
- [ ] **Step 4:** Record the derived parameters: `min_instances` warm count, instance type, the dead-session reap window (target ~60–90 s), and a go/no-go. Commit the spike (image promoted in Task 4; harness Worker discarded).

---

## Phase 1 — Permissions, schema & coordinator skeleton

### Task 1: `documents:` permission namespace

**Files:**
- Modify: `packages/access-control/src/permissions.ts` (the PERMISSIONS registry + `RESOURCE_BY_PERMISSION_NAMESPACE`)
- Test: `packages/access-control/src/permissions.test.ts`

**Interfaces:**
- Produces: permission keys `documents:edit`, `documents:checkout`, `documents:forceReleaseLock`, `documents:reconcile`; namespace `documents` mapped to the `matter` resource.

- [ ] **Step 1:** Write a failing test asserting the four `documents:*` permissions exist, are seeded to the expected roles (edit/checkout/reconcile → matter-team-edit + admin; forceReleaseLock → matter-team-edit + admin/owner), and `RESOURCE_BY_PERMISSION_NAMESPACE['documents'] === 'matter'`.
- [ ] **Step 2:** Run it; expect FAIL (unknown permission keys).
- [ ] **Step 3:** Add the namespace + keys + role seeds + the resource mapping, following the existing `tools:`/`incidents:` rows as the pattern.
- [ ] **Step 4:** Run the access-control suite; expect PASS.
- [ ] **Step 5:** Commit (`feat(access-control): add documents permission namespace`).

### Task 2: Schema additions (Drizzle source of truth)

**Files:**
- Modify: `packages/database/src/per-firm-schema.ts` (the `file`/`file_version` tables; a new `document_checkout` table)
- Test: `packages/database/src/per-firm-schema.test.ts` (the schema-fitness + migration round-trip)

**Interfaces:**
- Produces: `file.current_r2_key`, `file.current_sha256`, `file.current_size_bytes`, `file.current_wopi_timestamp` (all nullable), `file.edit_state` (`'idle'|'coediting'|'checked_out'` DEFAULT `'idle'`); `file_version.reconciliation_status` (`'clean'|'conflict_pending'|'reconciled'` DEFAULT `'clean'`), `file_version.diverged_from_version_id` (nullable FK to `file_version.id`); table `document_checkout` (`id`, `file_id`, `holder_member_id`, `lock_type` `'exclusive'|'offline_working_copy'`, `base_version_id`, `acquired_at`, `last_activity_at`, `status` `'active'|'stale'|'released'|'reconciling'`, `idle_release_at`).

- [ ] **Step 1:** Write failing tests: the new columns/table exist with the stated defaults; CHECK constraints reject an out-of-enum `edit_state`/`reconciliation_status`/`lock_type`/`status`; a fresh migration applies and an existing `file` row gets `edit_state='idle'`/`reconciliation_status='clean'` (expand-contract safe default).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Add the columns + the `document_checkout` table to the Drizzle schema with CHECK constraints; generate the migration (number assigned at integration time — leave the generator to pick the next free after the per-firm head).
- [ ] **Step 4:** Run the database suite + the migration round-trip; expect PASS.
- [ ] **Step 5:** Commit (`feat(database): editing working-copy, checkout and reconciliation columns`).

### Task 3: `DocumentSession` Durable Object skeleton

**Files:**
- Create: `apps/worker/src/editing/document-session.ts` (the DO class)
- Modify: `apps/worker/wrangler.jsonc` (DO binding `DOCUMENT_SESSION`; migration tag)
- Test: `apps/worker/src/editing/document-session.test.ts` (Vitest + Miniflare DO)

**Interfaces:**
- Produces: class `DocumentSession extends DurableObject` with `ctx.storage` SQLite holding `session_state` (participants, wopi_lock_value, coolwsd_affinity, current metadata, checkout pointer); methods (RPC) `getState()`, `recordParticipant(memberId, capability)`, `dropParticipant(memberId)`, `setCurrentMeta({sha256, size, wopiTimestamp})`, `setAlarm(ms)`. Durable across container sleep.

- [ ] **Step 1:** Verify current DO docs (golden rule 11): `ctx.storage` SQLite API, `alarm()`, RPC method exposure, the Container-is-a-DO model.
- [ ] **Step 2:** Write a failing test: a `DocumentSession` stub stores participant + current-meta in SQLite, returns it from `getState()`, and survives a simulated eviction (new instance reads the persisted state).
- [ ] **Step 3:** Run; expect FAIL.
- [ ] **Step 4:** Implement the DO with the SQLite-backed state (no plain class fields for durable state) + the binding in `wrangler.jsonc` (purpose-named per ADR-0075).
- [ ] **Step 5:** Run the worker DO test; expect PASS. Commit (`feat(editing): DocumentSession durable object skeleton`).

### Task 4: Collabora container binding (least-privilege)

**Files:**
- Modify: `containers/collabora/Dockerfile` (promote the spike image), `containers/collabora/coolwsd.xml`
- Modify: `apps/worker/wrangler.jsonc` (Container config: image, instance type from Task 0, `min_instances`, `sleepAfter`)
- Modify: `apps/worker/src/editing/document-session.ts` (own/route to the container via `getContainer`/`containerFetch`)
- Test: `apps/worker/src/editing/document-session.test.ts`

**Interfaces:**
- Produces: `DocumentSession.containerFetch(request)` proxying to the document's coolwsd; the container has **no egress**, **no R2/D1 creds or key material**, runs ephemeral per document.

- [ ] **Step 1:** Verify current `@cloudflare/containers` config (golden rule 11): per-DO container ownership, `getContainer(binding, fileId)` keying, image/instance config, egress controls.
- [ ] **Step 2:** Write a failing test asserting the DO routes a WOPI-shaped request to its container and that the container config declares no egress + no bindings (config-fitness assertion).
- [ ] **Step 3:** Promote the image; wire the Container binding (`min_instances` from the spike) + `containerFetch`; lock down egress/creds in config.
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): per-document Collabora container, least-privilege`).

---

## Phase 2 — WOPI host & access tokens

### Task 5: Access-token mint + verify

**Files:**
- Create: `apps/worker/src/editing/wopi-token.ts`
- Test: `apps/worker/src/editing/wopi-token.test.ts`

**Interfaces:**
- Consumes: `apps/worker/src/constant-time.ts` (`timingSafeEqual`).
- Produces: `mintEditToken(claims: {firmId, matterId, fileId, versionId, memberId, capability: 'view'|'edit', sessionId}, env): Promise<string>` and `verifyEditToken(token: string, env): Promise<EditTokenClaims>` (throws `WopiTokenError` on bad MAC/expiry/skew); per-firm key via `HKDF(rootSigningKey, firmId)`; envelope carries `kid`; constant-time verify-before-trust; `jti` + short `exp` + clock-skew tolerance.

- [ ] **Step 1:** Write failing tests: round-trip mint→verify returns the claims; a tampered field fails verify (no claim read before MAC check); an expired token fails; a token signed with firm-A's derived key does not verify under firm-B; verify uses `timingSafeEqual` (assert via a wrapper spy); `access_token` value is never returned in any error message.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement HKDF-per-firm signing, the `kid` envelope, constant-time verify, skew + `jti`.
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): per-firm signed WOPI access tokens`).

### Task 6: WOPI guard — tenancy at use + capability

**Files:**
- Create: `apps/worker/src/editing/wopi-guard.ts`
- Test: `apps/worker/src/editing/wopi-guard.test.ts`

**Interfaces:**
- Consumes: `verifyEditToken`; the firm-binding resolver (existing `resolveFirmContext`/firm-DB binding from the chokepoint internals).
- Produces: `wopiGuard(c): Promise<{claims, firmDb, bucket, objectKeyFor(kind: 'current'|'version'): string}>`; re-derives key + firm DB/bucket **only** from the token; ignores request-path `fileId`; cross-firm/mismatch → 404; for write/lock ops, rejects `capability !== 'edit'`.

- [ ] **Step 1:** Write failing tests: a firm-A edit token presented against a firm-B `WOPISrc` → 404 and no firm-B object accessed (spy the bucket); a `view` token through the guard's write path → 403/refused; the derived object key matches `files/{fileId}/...` from the token, not the request path.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the guard.
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): WOPI guard with tenancy-at-use and server-side capability`).

### Task 7: CheckFileInfo + GetFile

**Files:**
- Create: `apps/worker/src/editing/wopi-routes.ts` (handlers)
- Test: `apps/worker/src/editing/wopi-routes.test.ts`

**Interfaces:**
- Consumes: `wopiGuard`; `@magna-carta/file-manager` reads (file/version metadata).
- Produces: `GET …/wopi/files/{fileId}` (CheckFileInfo JSON: `BaseFileName`, `Size`, `UserCanWrite` from capability, `LastModifiedTime` = the server `current_wopi_timestamp`); `GET …/wopi/files/{fileId}/contents` (GetFile → stream the token-derived object from R2).

- [ ] **Step 1:** Verify current WOPI CheckFileInfo/GetFile field names + semantics (golden rule 11).
- [ ] **Step 2:** Write failing tests: CheckFileInfo returns `UserCanWrite=false` for a view token and `true` for edit; `LastModifiedTime` echoes the DO-recorded value; GetFile streams the committed-version bytes for a read-only view and `current` for a live edit session; a cross-firm token → 404.
- [ ] **Step 3:** Run; expect FAIL. Implement both handlers (stream, no buffering).
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): WOPI CheckFileInfo and GetFile`).

### Task 8: PutFile — streaming hash, current object, timestamp guard

**Files:**
- Modify: `apps/worker/src/editing/wopi-routes.ts`
- Modify: `apps/worker/src/editing/document-session.ts` (record current meta; server-assign timestamp)
- Test: `apps/worker/src/editing/wopi-routes.test.ts`

**Interfaces:**
- Produces: `POST …/wopi/files/{fileId}/contents` (PutFile): pipes the body through a streaming SHA-256 into the R2 put of `files/{fileId}/current`; compares the presented `X-COOL-WOPI-Timestamp` against the **DO-recorded** `current_wopi_timestamp`; on mismatch returns **409 `{"COOLStatusCode":1010}`**; on success host-assigns a new timestamp and records `{sha256, size, wopiTimestamp}` on the DO.

- [ ] **Step 1:** Verify current Collabora PutFile timestamp-conflict + lock-mismatch semantics (golden rule 11): `X-COOL-WOPI-Timestamp` is a request header; the distinct standard 409s (X-WOPI-Lock mismatch; unlocked non-zero PutFile).
- [ ] **Step 2:** Write failing tests: a PutFile with a stale `X-COOL-WOPI-Timestamp` → 409/1010 and `current` unchanged; a fresh PutFile writes `current`, records the streamed SHA-256 (no buffered copy — assert via a size-bounded stream), and host-assigns a new timestamp; a `view` token PutFile → rejected, nothing written.
- [ ] **Step 3:** Run; expect FAIL. Implement the streaming-hash PutFile + the server-authoritative timestamp compare.
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): WOPI PutFile with streaming hash and timestamp guard`).

### Task 9: Lock / Unlock / RefreshLock / UnlockAndRelock

**Files:**
- Modify: `apps/worker/src/editing/wopi-routes.ts`, `apps/worker/src/editing/document-session.ts` (the single session lock in DO SQLite)
- Test: `apps/worker/src/editing/wopi-routes.test.ts`

**Interfaces:**
- Produces: the WOPI `X-WOPI-Override` Lock family on `POST …/wopi/files/{fileId}`; one session lock per document held in the DO; first editor locks, co-editors join the same lock, last leaver unlocks; 409 + `X-WOPI-Lock` current-value on mismatch.

- [ ] **Step 1:** Verify current WOPI Lock contract (golden rule 11): lock string ≤1024 chars, file-scoped, 30-min default expiry, the `X-WOPI-Lock` mismatch response.
- [ ] **Step 2:** Write failing tests: first Lock succeeds and stores the lock in the DO; a second editor joining reuses the session (no new lock); a Lock with the wrong current value → 409 + `X-WOPI-Lock` header carrying the held value; Unlock by the last leaver clears it; a `view` token Lock → rejected.
- [ ] **Step 3:** Run; expect FAIL. Implement the lock family against the DO.
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): WOPI lock family on the session DO`).

### Task 10: Editor-launch route + iframe origin/CSP

**Files:**
- Create: `apps/worker/src/editing/edit-session-route.ts`
- Modify: the route composition root (`apps/worker/src/.../v1` registration)
- Test: `apps/worker/src/editing/edit-session-route.test.ts`

**Interfaces:**
- Consumes: `defineOpenAPIRoute`, the chokepoint, `mintEditToken`, the Collabora discovery `urlsrc`.
- Produces: `POST /api/v1/documents/{fileId}/edit-session` → `{ editorUrl, accessToken, accessTokenTtl }` where `editorUrl` is `urlsrc?WOPISrc=<host>/wopi/files/{fileId}` on the cookieless editor origin; `accessTokenTtl` an absolute epoch-ms hours-window value; sets `frame-ancestors`/CSP for the editor origin.

- [ ] **Step 1:** Write failing tests: launch requires `documents:edit` (matter-scoped) → 403 for a walled member; returns a well-formed `editorUrl` with `WOPISrc` + the minted token; `accessTokenTtl` is absolute epoch-ms (hours), distinct from the internal token `exp`; the route is in the chokepoint + emitted to the OpenAPI snapshot.
- [ ] **Step 2:** Run; expect FAIL. Implement the route (discovery fetch cached; token mint; CSP headers).
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): editor-launch route and cookieless editor origin`).

### Task 11: Errors & diagnostics on the WOPI surface

**Files:**
- Modify: `apps/worker/src/editing/wopi-guard.ts`, `wopi-routes.ts`
- Test: `apps/worker/src/editing/wopi-diagnostics.test.ts`

**Interfaces:**
- Consumes: `@magna-carta/telemetry` Logger seam (`cor_`/`err_` builders).
- Produces: every WOPI fault returns the WOPI-contract status to coolwsd **and** emits a redacted telemetry event with an `err_` Error ID; a `cor_` correlation ID is minted per callback.

- [ ] **Step 1:** Write failing tests: a forced R2 error on GetFile returns the WOPI status AND emits one redacted event carrying an `err_` id; the emitted event contains **no** document bytes and **no** `access_token` (assert the scrubber/allowlist drops them); a container-spawn failure on launch surfaces an Error ID.
- [ ] **Step 2:** Run; expect FAIL. Wire telemetry through the guard + handlers.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): redacted error pipeline on the WOPI surface`).

---

## Phase 3 — Version model

### Task 12: Version-cut from `current` (CopyObject + commit + no-op skip)

**Files:**
- Create: `apps/worker/src/editing/version-cut.ts`
- Modify: `packages/file-manager/src/file-service.ts` (a sibling commit path that needs no `upload_session`)
- Test: `packages/file-manager/src/file-service.test.ts`, `apps/worker/src/editing/version-cut.test.ts`

**Interfaces:**
- Consumes: the DO `current` meta (`sha256`, `size`); `commitEffectBatch`; `meterTierChangeStatements` is unrelated here.
- Produces: `commitEditedVersion({firmDb, fileId, currentKey, sha256, size, actorMemberId}): Promise<{versionId, skipped: boolean}>` — if `sha256 === latestVersionSha256` returns `{skipped:true}` (no-op); else `CopyObject` `current` → `files/{fileId}/{versionId}`, writes the immutable `file_version` row (monotonic `version_number`), increments `storage_meter`, audits `file.version_committed`, emits the outbox topic — all in one batch.

- [ ] **Step 1:** Write failing tests: an unchanged `sha256` skips (no version, no meter change); a changed `sha256` cuts a monotonic version, the bytes land at the version key via CopyObject (spy), the meter increments by `size`, and the audit + outbox rows are written in one batch; the actor is the resolved member, never null.
- [ ] **Step 2:** Run; expect FAIL. Implement the sibling commit path.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): cut immutable versions from the current working object`).

### Task 13: Version-cut triggers (Save + session-close, not autosave/join)

**Files:**
- Modify: `apps/worker/src/editing/wopi-routes.ts` (PutFile reads `X-COOL-WOPI-IsAutosave`), `document-session.ts` (session-close on last-leaver)
- Test: `apps/worker/src/editing/version-cut-triggers.test.ts`

**Interfaces:**
- Produces: an explicit Save (`IsAutosave=false`) calls `commitEditedVersion`; `dropParticipant` reaching zero participants cuts a session-close version; autosave (`IsAutosave=true`) and a co-author join cut nothing.

- [ ] **Step 1:** Verify the `X-COOL-WOPI-IsAutosave` header semantics (golden rule 11).
- [ ] **Step 2:** Write failing tests: explicit Save cuts; autosave only updates `current` (no version); a join cuts nothing; last-leaver session-close cuts exactly one version.
- [ ] **Step 3:** Run; expect FAIL. Implement the trigger wiring.
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): deliberate version-cut triggers`).

---

## Phase 4 — Concurrency & reconciliation

### Task 14: Co-editing join + read-only viewer

**Files:**
- Modify: `apps/worker/src/editing/edit-session-route.ts`, `document-session.ts`
- Test: `apps/worker/src/editing/coediting.test.ts`

**Interfaces:**
- Produces: a second `edit-session` on a live document returns a token that **joins** the existing session (same `sessionId`/lock); a view-capability launch joins read-only; `edit_state` transitions `idle→coediting` and back on reap.

- [ ] **Step 1:** Write failing tests: two edit launches on one document share the session lock (one WOPI lock total); a view launch during a live session succeeds (read-only) and never blocks; `edit_state` reflects `coediting`.
- [ ] **Step 2:** Run; expect FAIL. Implement join + viewer semantics.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): co-editing join and never-blocked read-only viewer`).

### Task 15: Checkout (presigned) + check-in (through quarantine ingest) + divergence

**Files:**
- Create: `apps/worker/src/editing/checkout-routes.ts`
- Modify: `apps/worker/src/files/ingest-consumer.ts` (recognize a check-in-origin object → route to divergence resolution after clearing)
- Test: `apps/worker/src/editing/checkout.test.ts`

**Interfaces:**
- Consumes: the presign helper (`aws4fetch` SigV4, ADR-0081); the `files-ingest` queue + consumer.
- Produces: `POST /api/v1/documents/{fileId}/checkout` → `{ presignedGetUrl (short TTL, server-derived key), checkoutId }` and sets a `document_checkout` row (`offline_working_copy`, `base_version_id`); `POST …/checkin` → a presigned PUT into the quarantine pipeline; after the gate clears, `resolveCheckin(fileId, checkoutId, cleanObjectKey)`: if `current_version_id === base_version_id` fast-forward (cut a normal version), else create a **conflicting copy** (`file_version` with `reconciliation_status='conflict_pending'`, `diverged_from_version_id=base`) and flag the document.

- [ ] **Step 1:** Write failing tests: checkout returns a presigned GET whose key is server-derived and cannot be rewritten to another firm/file (mutate the URL → 403/404 from R2 path/sig); check-in bytes land `status='pending'` and route the `files-ingest` consumer (spy) — never opened by a container before clearing; a non-advanced base fast-forwards; an advanced base produces a flagged conflicting copy and **never overwrites** current.
- [ ] **Step 2:** Run; expect FAIL. Implement checkout/check-in + divergence detection through the ingest path.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): offline checkout/check-in via quarantine ingest with divergence detection`).

### Task 16: Reconciliation resolution

**Files:**
- Modify: `apps/worker/src/editing/checkout-routes.ts`
- Test: `apps/worker/src/editing/reconcile.test.ts`

**Interfaces:**
- Produces: `POST /api/v1/documents/{fileId}/reconcile` (`documents:reconcile`, matter-scoped) `{ keep: 'current'|'incoming'|'both', resolvedNote? }` → cuts the resolved version (or marks the conflicting copy superseded), flips `reconciliation_status conflict_pending→reconciled`, clears the document flag + the reconciling checkout, audits `document.reconciled`, emits the outbox topic. The conflicting copy is **retained forever** regardless of `keep`.

- [ ] **Step 1:** Write failing tests: reconcile flips the status to `reconciled`, clears the flag, cuts/labels the right version per `keep`, audits with both the actor and the resolution; the conflicting `file_version` row still exists afterward (retained); a walled member → 404.
- [ ] **Step 2:** Run; expect FAIL. Implement the resolution mutation.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): human reconciliation resolution`).

### Task 17: Exclusive lock, stale reap & force-release

**Files:**
- Create: `apps/worker/src/editing/lock-admin.ts`
- Modify: `apps/worker/src/editing/document-session.ts` (heartbeat alarm reap)
- Test: `apps/worker/src/editing/lock-admin.test.ts`

**Interfaces:**
- Produces: `POST …/documents/{fileId}/checkout` with `lock_type='exclusive'` (opt-in); the DO alarm reaps a dead co-edit session within the spike-derived window (cut session-close version, `edit_state→idle`); `POST …/documents/{fileId}/force-release` (`documents:forceReleaseLock`, **matter-scoped**) releases an exclusive lock and audits both actor + displaced holder; a generous, firm-configurable idle auto-release flips `status active→stale→released`; a revoked member's check-in is refused + the checkout force-released.

- [ ] **Step 1:** Write failing tests: an exclusive lock makes a second edit launch read-only (others still read); a dead session is reaped by the alarm and the document frees; force-release by an authorized member releases + audits both parties; a **walled-off-but-firm-admin** member → 404 on force-release (matter-scoped denial); a deactivated member's check-in is refused and their checkout force-released.
- [ ] **Step 2:** Run; expect FAIL. Implement the exclusive lock, the alarm reap, and force-release.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): exclusive lock, stale-session reap, matter-scoped force-release`).

---

## Phase 5 — Storage tiering

### Task 18: Standard→IA tiering (conservative trigger)

**Files:**
- Create: `apps/worker/src/editing/tiering-sweep.ts`
- Modify: `apps/worker/wrangler.jsonc` (cron, reusing the reconciliation cadence)
- Test: `apps/worker/src/editing/tiering.test.ts`

**Interfaces:**
- Consumes: `meterTierChangeStatements` (file-manager, ADR-0078).
- Produces: a cron sweep that, for **superseded, non-current** versions older than the IA 30-day minimum, `CopyObject`s in place to `STANDARD_IA` and updates `storage_meter` in the same batch; never tiers the live/latest version; never deletes.

- [ ] **Step 1:** Verify R2 `CopyObject` in-place storage-class change (`x-amz-storage-class`) + IA 30-day minimum (golden rule 11).
- [ ] **Step 2:** Write failing tests: the sweep tiers only superseded non-current versions past the window; the live/latest version is never tiered; the meter updates in the same batch (class shift, object-count net-zero); nothing is deleted.
- [ ] **Step 3:** Run; expect FAIL. Implement the conservative sweep.
- [ ] **Step 4:** Run; expect PASS. Commit (`feat(editing): conservative Standard-to-IA version tiering`).

---

## Phase 6 — Reliability, contract, lifecycle, load profile, fitness, e2e, docs

### Task 19: Keep-alive + durable reconnect

**Files:**
- Modify: `apps/worker/src/editing/document-session.ts`
- Test: `apps/worker/src/editing/reliability.test.ts`

**Interfaces:**
- Produces: an **alarm-driven** keep-alive (`renewActivityTimeout` + container ping; pre-extend `sleepAfter` before long ops) — never WebSocket-frame-driven; on a simulated container death the session re-establishes from DO SQLite + R2 `current` with zero lost work.

- [ ] **Step 1:** Write failing tests: the alarm fires the keep-alive on cadence (not on WS frames); after a simulated container eviction the next callback re-establishes the session from durable state and no version/work is lost.
- [ ] **Step 2:** Run; expect FAIL. Implement the alarm-driven keep-alive + reconnect.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): alarm-driven keep-alive and durable reconnect`).

### Task 20: `current`-object lifecycle on delete / restore

**Files:**
- Modify: `packages/file-manager/src/file-service.ts` (soft-delete + restore paths), `apps/worker/src/editing/document-session.ts`
- Test: `packages/file-manager/src/file-service.test.ts`

**Interfaces:**
- Produces: soft-deleting a file with a live session reaps the session first (cut session-close version) then soft-deletes; `current` is destroyed-with-file and its `storage_meter` row decremented; undelete restores or lazily re-materializes `current` from `current_version_id`; version-restore copies an archived version forward into a new `current` + cuts a new version (forward-only).

- [ ] **Step 1:** Write failing tests: soft-delete with a live session reaps then deletes and decrements the meter for `current`; undelete re-materializes `current`; version-restore writes a new `current` and cuts a forward version without rewriting history.
- [ ] **Step 2:** Run; expect FAIL. Implement the lifecycle.
- [ ] **Step 3:** Run; expect PASS. Commit (`feat(editing): current-object lifecycle on delete and restore`).

### Task 21: OpenAPI contract + WOPI allow-list

**Files:**
- Modify: the OpenAPI snapshot + the `PUBLIC_ALLOW_LIST` conformance config
- Test: the existing contract drift + conformance suite

**Interfaces:**
- Produces: the session routes (`edit-session`, `checkout`, `checkin`, `force-release`, `reconcile`, reads) in the committed `openapi.json`; the WOPI routes declared token-guarded in `PUBLIC_ALLOW_LIST` with a justification.

- [ ] **Step 1:** Run the snapshot-drift + conformance suite; expect FAIL (new routes not in snapshot; WOPI routes not allow-listed).
- [ ] **Step 2:** Regenerate the snapshot + the generated client; add the WOPI allow-list entries with the documented reason.
- [ ] **Step 3:** Run the contract gates; expect PASS. Commit (`feat(editing): OpenAPI contract for editing routes; WOPI allow-list`).

### Task 22: Load-profile harness extension

**Files:**
- Modify: `packages/fixtures/` (the volume profile generator + measured set)
- Test: the fixtures measure harness (committed baseline)

**Interfaces:**
- Produces: editing volume (version-row accretion, the version-cut write batch, the tiering sweep, the `storage_meter` rollup under growth, the DO SQLite read on the WOPI hot path) in the profile; profile bumped to the next `ledgerVolume` version; seed-twice determinism preserved.

- [ ] **Step 1:** Verify the fixtures accretion recipe (`packages/fixtures/CLAUDE.md`).
- [ ] **Step 2:** Write/extend the profile to generate editing volume through the real write paths; add the measured ops; bump the profile version.
- [ ] **Step 3:** Run `pnpm --filter @magna-carta/fixtures run measure`; confirm seed-twice determinism + no hot-path full scans; commit the new baseline (`feat(fixtures): editing volume profile and measured ops`).

### Task 23: Fitness functions

**Files:**
- Create: `apps/worker/src/editing/editing.fitness.test.ts`
- Test: the same

**Interfaces:** the spec §12 set, as executable fitness tests.

- [ ] **Step 1:** Write the fitness tests: no code path shares one coolwsd across documents (source scan); a container config has no R2/D1 creds + no egress; a firm-A token → 404 on a firm-B doc; a view token cannot mutate `current` or the lock; check-in bytes route the ingest consumer; a walled-admin is 404 on force-release; reading is reachable in every `edit_state`.
- [ ] **Step 2:** Run; fix any real gaps surfaced (these guard the must-fix invariants).
- [ ] **Step 3:** Commit (`test(editing): slice 2·2 fitness functions`).

### Task 24: End-to-end suite

**Files:**
- Create: `apps/worker/src/editing/editing.e2e.test.ts`

**Interfaces:** the whole journey over the real HTTP + WOPI surface.

- [ ] **Step 1:** Write the e2e: provision → upload a `.docx` (1·1) → launch edit → PutFile (current) → explicit Save (cut v) → second editor joins (co-edit) → viewer joins read-only → checkout (presigned) → check-in (advances meanwhile) → conflicting copy + flag → reconcile → exclusive lock → reap → force-release → tiering sweep → tenant-isolation cross-firm 404.
- [ ] **Step 2:** Run the full worker suite + `pnpm check` + `lint:process-refs`; expect PASS.
- [ ] **Step 3:** Commit (`test(editing): slice 2·2 end-to-end journey`).

### Task 25: Documentation (definition-of-done)

**Files:**
- Modify: `ROADMAP.md`, `STATUS.md`, `changelog.d/<slug>.md`, the white-paper _Documents → Editing_ / _versioning & tiering_ sections; finalize the two `docs/decisions/pending/<slug>.md` (status Accepted on owner sign-off)
- Test: `pnpm run lint:process-refs` (source/tests clean of process refs)

- [ ] **Step 1:** Update ROADMAP (2·2 → built), STATUS (the 2·2 row with the model tag), the changelog fragment, the white-paper editing/versioning sections; note user docs deferred to the UI fast-follow (explicit per documentation.md).
- [ ] **Step 2:** Run `lint:process-refs` + `pnpm check`; expect PASS.
- [ ] **Step 3:** Commit (`docs(editing): slice 2·2 roadmap, status, changelog, white-paper`).

---

## Self-review notes

- **Spec coverage:** §2 topology → T3/T4; §3 WOPI host → T6–T9; §3a iframe → T10; §4 auth → T5/T10; §4a errors → T11; §5 version model → T12/T13; §6 tiering → T18; §7 concurrency/reconcile → T14–T17; §8 schema/lifecycle → T2/T20; §9 reliability/spike → T0/T19; §10 contract/idempotency/audit → T10/T15/T16/T21; §12 fitness/load-profile → T22/T23; §13 docs → T25. No uncovered section.
- **Spike-gated values** (warm count, instance type, reap window) are produced by T0 and consumed by T4/T17/T19 — do not hard-code before the spike.
- **Idempotency:** checkout/checkin/force-release/reconcile carry `Idempotency-Key` (chokepoint); the internal version-cut is idempotent by `(fileId, current_sha256)` (T12 no-op skip) — not the header.
- **Golden rule 11 gates** are embedded as Step-1 doc-verification in every container/WOPI/R2 task (T0, T3, T4, T7, T8, T9, T13, T18).
