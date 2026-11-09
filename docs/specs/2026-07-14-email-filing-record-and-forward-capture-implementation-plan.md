# Email filing — record model & forward/CC capture (slice 1) — implementation plan

**Design:** [`2026-07-14-email-filing-record-and-forward-capture-design.md`](2026-07-14-email-filing-record-and-forward-capture-design.md)
**Parent:** [`2026-06-16-email-filing-design.md`](2026-06-16-email-filing-design.md)

This plan builds the matter-email **record model** and the **forward/CC capture** path (plus the add-in's future API target) in dependency order — vertical, each task landing something exercised by tests. It reuses the `@magna-carta/email` parser and the File Manager ingest chokepoint; it writes no web UI (deferred to the UI plan).

## Global constraints

- **Firm-scoped data-access only.** Every new query goes through the firm-scoped data-access layer over the `FirmDatabase` Durable Object; no query crosses firms; the verbatim message and attachment bytes live in per-firm R2, never D1 (ADR-0003, golden rule 3).
- **One parser.** All parsing is `@magna-carta/email` (`parseMessage` / `extractPart`) over the committed WASM module — the same engine the Email Inspector uses. No second parse implementation, no PostalMime.
- **Off the hot path.** The two entrances enqueue; parse / hash / attachment-extract run in a Queue consumer (ADR-0039). No heavy work in a request handler.
- **Absence-not-existence.** Every read that could reveal a walled matter (the "already filed" signal, the "also on …" list) filters to the caller's access and never leaks a matter identity (ADR-0052).
- **Untrusted bytes.** The raw message and every attachment are hostile input: parsing is the hardened engine, attachments ride the quarantine chokepoint, nothing is served inline-active (ADR-0081, ADR-0029).
- **Full names, no shorthand** (golden rule 12): `@magna-carta/email-filing`, `emailMessage`, `directoryEntityId` — never `msg`, `entId`. **No process-doc references in source** (golden rule 13): comments state the reasoning or cite a file, not an ADR/slice number; a forward-looking "the add-in slice posts here" schedule note is the one allowed form.
- **Contract discipline.** New routes register through the chokepoint with full `RouteMeta`; re-emit `openapi/openapi.json` and regenerate the client in the same commit; update the conformance operation list.
- **Docs in the same commit** (golden rule 5): the changelog/decision/status fragments, the user guide, and the white-paper delta land with the code.

## File structure

```
packages/email-filing/                         NEW — the pure record-model + capture-orchestration package
  package.json                                 @magna-carta/email-filing
  src/
    index.ts                                   barrel: captureEmail, dedup, thread-linking, the record types
    record.ts                                  the ParsedMessage -> record-row mapping (typed, no serde surprises)
    dedup.ts                                   dedup-key derivation (Message-ID; normalized-header+body fallback)
    thread.ts                                  DAG linking by In-Reply-To / References
    capture.ts                                 captureEmail(bytes, context) — the single convergent operation
    already-filed.ts                           the wall-safe "already filed" query shape
    seams.ts                                   the no-op conflict-hook, notifications-raise, dkim-verdict boundary
  test/
    dedup.test.ts  thread.test.ts  capture.test.ts  already-filed.test.ts

packages/database/
  src/per-firm-schema.ts                       + emailMessage, emailThread, emailMatterLink, emailParticipant, emailAttachment
  drizzle/per-firm/<ts>_email-filing-records.sql       the tables + indexes
  drizzle/per-firm/<ts>_seed-emails-permissions.sql    seed emails:* onto the default roles

packages/data-access/src/
  email-filing-statements.ts                   NEW — the firm-scoped statements (upsert message, link, reads)

packages/access-control/src/registry.ts        + the emails:* namespace

apps/email-worker/                             NEW — the Cloudflare Email Worker (forward/CC entrance)
  wrangler.jsonc  src/index.ts (email handler)  src/routing.ts (address -> firm/matter)  test/

apps/worker/src/
  routes/email/emails.ts                             NEW — POST /matters/{id}/emails, GET reads, already-filed
  emails/capture-consumer.ts                   NEW — the ingest Queue consumer calling captureEmail
  app.ts                                        register the routes + consumer
  wrangler.jsonc                                + the capture queue + (dev) the email-worker service binding
  openapi/openapi.json                          re-emitted
packages/api-client/src/*.gen.ts                regenerated

docs/user/features/filing-email-to-a-matter.md NEW — the end-user guide
changelog.d/ · docs/decisions/pending/ · status.d/ · docs/active-work/   fragments
```

### Task 1: The record schema + migration

Add the five tables to `packages/database/src/per-firm-schema.ts` (Drizzle), following the existing `file` / `matter_party` definitions for column and index style, and emit the matching `drizzle/per-firm/<ts>_email-filing-records.sql`.

- `emailMessage` — firm-scoped id; `messageIdValue` + `messageIdProvenance` (`header|mapi|absent`); `subject`; `sentAt`/`receivedAt` (integer epoch ms, the ADR-0055 instant encoding used elsewhere); `fromDisplay`/`fromAddress`; `threadId`; `inReplyTo`; `contentSha256`; `dedupKey`; `originalR2Key`; `referencesRemoteContent`; `integrity` (JSON text — the verbatim DKIM/Authentication-Results/Received facts); `dkimVerdict` (default `unverified`); `sourceFormat`; `capturedVia`. **Unique index on `(dedupKey)`** (the table is already per-firm). Index `threadId`, `messageIdValue`.
- `emailThread` — `id`, `subjectNormalized`, `firstSeenAt`. (Edges are carried on `emailMessage.threadId` + `inReplyTo`/`references`; a separate edge table is deferred with the integrity work.)
- `emailMatterLink` — `id`, `emailMessageId`, `matterId`, `state` (`staged|filed|unlinked`), `linkedBy`, `linkedAt`, `capturedVia`, `tags` (JSON). **Unique on `(emailMessageId, matterId)`**; index `matterId` (a matter's email list) and `emailMessageId` (the "also on …" list).
- `emailParticipant` — `id`, `emailMessageId`, `kind` (`from|to|cc|bcc`), `displayName`, `address`, `directoryEntityId` (nullable — written null this slice, §6 of the design). Index `emailMessageId`.
- `emailAttachment` — `id`, `emailMessageId`, `fileId` (the File Manager document), `filename`, `mediaType`, `disposition` (`attachment|inline`), `promotedFromInline` (bool). Index `emailMessageId`, `fileId`.

**Tests** (`packages/database/test/`): the migration applies onto the baseline; the unique constraints reject a duplicate `dedupKey` and a duplicate `(message, matter)` pair; a `matter` delete cascades/guards links per the `file` precedent. Mirror `per-firm-directory-migration.test.ts`.

### Task 2: `@magna-carta/email-filing` — dedup, threading, the record mapping

The pure package (no I/O; takes a `ParsedMessage`, returns rows and decisions). Depends on `@magna-carta/email` for the types and `@magna-carta/identifiers` for id minting.

- `dedup.ts` — `deriveDedupKey(message): { key: string; basis: "messageId" | "contentHash" }`. When `message.messageIdentifier.value` is present, the key is `messageId:<value>`; otherwise a SHA-256 over normalized headers (canonical name casing, sorted, value-trimmed) + the first text/plain body, whitespace-collapsed. The **provenance is kept** (`messageIdProvenance`) — a header-sourced and a MAPI-sourced identifier with the same bytes are _not_ the same key basis, matching the engine's typed `MessageIdentifier` (never flatten).
- `thread.ts` — `linkThread(message, existingByMessageId)`: resolve `inReplyTo`/`references` to an existing `threadId`, else open a new thread. Returns the `threadId` and the parent edge. DAG, not a line — multiple references are allowed.
- `record.ts` — `toRecordRows(message, context)`: the total mapping from `ParsedMessage` to the five row shapes, participants included, `directoryEntityId` null, `integrity` serialized verbatim, `dkimVerdict: "unverified"`.

**Tests:** same Message-ID → one key; stripped Message-ID → content-hash key stable across two recipient copies of the same forwarded message; header-vs-MAPI provenance never collapses; a reply links to its parent's thread; two unrelated messages get two threads.

### Task 3: The firm-scoped statements

`packages/data-access/src/email-filing-statements.ts`, following the existing `member-statements.ts` / directory `party.ts` style — prepared statements bound to a firm `SqlDatabase` handle:

- `upsertEmailMessage(db, rows)` — insert-or-return-existing on `dedupKey`; on conflict, update provenance ("also confirmed") rather than duplicate. Writes the message + participants in one batch.
- `linkEmailToMatter(db, { emailMessageId, matterId, state, linkedBy, capturedVia })` — insert the junction (unique-guarded); a re-link to the same matter is idempotent.
- `acceptStagedLink` / `unlinkEmailFromMatter` — state transitions (`staged→filed`, `*→unlinked`); unlink never deletes the message.
- `readMatterEmails(db, matterId, cursor)` — a matter's filed threads (cursor-paginated per `cursor-pagination.ts`).
- `readThreadMessages(db, threadId)` — the DAG for one thread.
- `findByDedupKey(db, key)` and `mattersForMessageVisibleTo(db, emailMessageId, accessibleMatterIds)` — the dedup probe and the wall-safe "already filed" / "also on" reads (the caller passes the matter ids it may see; the query never returns others).

**Tests (Miniflare, real bindings):** upsert converges; link is idempotent and unique; the visibility read returns only accessible matters and a bare count for the rest.

### Task 4: `emails:*` permissions + role seed

Add to `packages/access-control/src/registry.ts` (one namespace block, registry-ordered), and seed onto the default roles via `drizzle/per-firm/<ts>_seed-emails-permissions.sql` (mint the `rolePermission_` handles as literals, exactly as `…_seed-tools-email-inspector.sql` does):

- `emails:file` — capture/file an email to a matter (the API entrance).
- `emails:read` — read a matter's filed emails and threads.
- `emails:manageLinks` — accept a staged link, link to additional matters, unlink.
- `emails:manageCaptureAddresses` — mint/rotate a matter's forward token and manage the firm catch-all (admin).

Seed `emails:file`/`emails:read`/`emails:manageLinks` to the staff roles; `manageCaptureAddresses` to Owner/Admin. Matter-scoped routes bind `resource: "matter"` (the `files:*` precedent — file objects and email links are matter-rooted).

### Task 5: The capture operation + ingest consumer

`packages/email-filing/src/capture.ts` — `captureEmail(bytes, context)`: ensure the WASM engine is ready, `parseMessage(bytes)`, derive the dedup key, persist the verbatim original to R2 (content-addressed key so re-capture is idempotent at the blob layer), `upsertEmailMessage`, `linkThread`, then enqueue attachment extraction (Task 6) and stage the `emailMatterLink`. Returns `{ emailMessageId, threadId, dedupState: "new" | "existing", linkState }`.

`apps/worker/src/emails/capture-consumer.ts` — the Queue consumer for the new `emails-capture` queue: pulls a staged capture job (a pointer to the staged raw bytes in R2 + the resolved firm/matter context), runs `captureEmail`, writes the result, raises the (no-op) notifications seam. Idempotent on the capture job id, mirroring `ingest-consumer.ts`'s `ingest:<versionId>` batch key.

**Tests (Miniflare):** a captured `.eml` fixture produces a message + participants + a staged link; a second capture of the same bytes is deduped (no second message, provenance updated); an `.msg` fixture routes through the same path.

### Task 6: Attachment extraction onto the chokepoint

In the consumer, for each real attachment `PartDescriptor` (disposition `attachment`, or an `inline` part with no `cid:` reference), call `extractPart` and hand the bytes to the File Manager ingest path — staging a `file`/`file_version` rooted to the link's matter, so it rides magic-byte sniff → scan → quarantine exactly like an uploaded file (the `runIngest` chokepoint). Record an `emailAttachment` row tying the `fileId` back to the message. Decorative `cid:` inline images are recorded with `disposition: "inline"` and **not** made documents (a one-click "promote" later is a data change, not a re-parse). Bound each part to the ingest size cap; over it, record a `capture_oversize` attachment outcome rather than failing the whole message.

**Note the reuse boundary:** this calls the File Manager's existing ingest entry, it does **not** re-implement scanning or hashing. Per the design §5 constraint, blobs land under per-version keys (not content-addressed), so an attachment filed to N matters is N matter-rooted documents; true single-blob storage is a named enhancement, not built here.

**Tests:** a with-attachment fixture lands a quarantined (`unscanned`) File Manager document + an `emailAttachment` row; an inline logo is filtered; an oversize part records the outcome without dropping the message.

### Task 7: The API entrance — `POST /api/v1/matters/{matterId}/emails`

`apps/worker/src/routes/email/emails.ts`, registered through the chokepoint with full `RouteMeta` (`permission: "emails:file"`, `resource: "matter"`, `rateLimit: "expensive"`, `idempotency: "optional"`), body `application/octet-stream` (raw `.eml`/`.msg` bytes). The handler stages the bytes to R2 and enqueues an `emails-capture` job scoped to `{ firmId, matterId, capturedVia: "api" }`; returns `202 { emailMessageId?, jobId, dedupState }` (or `200` with the existing message when the dedup probe hits synchronously). Problem responses reuse the Email Inspector's mapping of `EmailError` codes (`unsupported`/`malformed` → 422, `limitExceeded` → 413) plus 401/403/404/413/429. This is the endpoint the **add-in slice** will post "Save & File" / "Send & File" to — a forward-looking dependency, named here.

Read routes in the same module: `GET /api/v1/matters/{matterId}/emails` (a matter's threads, `emails:read`), `GET /api/v1/emails/{emailMessageId}` (one message with its "also on …" list filtered to the caller, `emails:read`), and `GET /api/v1/emails/already-filed` (by `messageId` or content hash; the wall-safe signal, `emails:read`).

**Tests (Miniflare):** post `.eml` → 202 → accept → the matter read shows it; multi-matter (post the same message to a second matter → two links, one message); the already-filed read hides a walled matter; missing `emails:file` → 403; a PDF body → 422.

### Task 8: The Cloudflare Email Worker — forward/CC entrance

`apps/email-worker/` (a new worker, `apps/scan-worker` as the template): an `email()` handler that receives the forwarded message, reads the destination address, and resolves it in `routing.ts` — a per-matter token address (`matter-<token>@in.magnacarta.esq` → firm + candidate matter) or the firm catch-all (→ firm, unrouted). It stages the raw MIME to the firm's R2 and enqueues the same `emails-capture` job (`capturedVia: "forward"`, `state: "staged"`). Over the ~25–40 MiB Email Routing ceiling it records `capture_oversize` and does not silently drop. The capture-address token store (a per-firm table minted by `emails:manageCaptureAddresses`) is created here.

DNS is a deploy-time step (the inbound capture subdomain co-tenants the `magnacarta.esq` zone; one DMARC coordinates it with product-send and the company Workspace) — documented in the operations runbook, not code.

**Tests:** the routing resolver maps a token address to firm+matter and a catch-all to firm+unrouted; an over-ceiling message records the oversize outcome. (The `email()` binding can't run in the local pool — resolve the routing purely and inject a fake send, the `resolveScanPort` pattern.)

### Task 9: Wiring, contract, and the seams

- Register the routes and the `emails-capture` consumer in `apps/worker/src/app.ts`; declare the queue (+ dead-letter) and, in dev, the email-worker service binding in `wrangler.jsonc`.
- `packages/email-filing/src/seams.ts`: the filing-time **conflict hook** (a no-op returning "no conflict" now; the Phase-4 engine drops in behind it), the **notifications raise** (a no-op carrying a deep link, never body), and the **dkim-verdict** boundary (the field stays `unverified`; the verifier is a named future consumer). Each is called from the capture/link path so the later build is a body swap, not a new call site.
- Re-emit `openapi/openapi.json`, regenerate `packages/api-client`, extend the conformance not-vacuous operation list.

**Tests:** the contract snapshot matches; conformance covers the new operations; the seam calls are exercised (the no-op conflict hook is invoked on every link).

### Task 10: Documentation, fragments, and the gate

- **User guide** `docs/user/features/filing-email-to-a-matter.md` — plain language: the forward/CC address, uploading an `.eml`/`.msg`, what gets filed (message + real attachments, inline logos skipped), "already filed", multi-matter. No architecture.
- **White paper** — the _Communications layer_ email section gains the inbound-capture entrances and the record model; reconcile the mailbox-sync-is-the-integration framing.
- **Fragments:** `changelog.d/email-filing-record-and-forward-capture.md` (category Added); `docs/decisions/pending/` — the two ADRs this slice realizes (subsystem architecture; data model) and the wall-safe-indicator decision (records the seam); `status.d/email-filing.md` (the new slice fragment). Add the operations-runbook step for the capture subdomain DNS + one DMARC.
- **Load profile** (ADR-0083): register the volume-shaped reads (a matter's threads, a thread's messages, the already-filed lookup, the dedup probe) in the harness.
- Run the full gate (`pnpm check` + `vp test`) and the process-refs / status linters before the PR.

## Sequencing & parallelism

Tasks 1→2→3 are the foundation (schema → pure logic → statements) and are sequential. Task 4 (permissions) is independent and can land anytime before the routes. Tasks 5–6 (capture + attachments) depend on 1–3. Tasks 7 (API) and 8 (Email Worker) are two entrances on the same capture core and can be built in parallel once 5–6 exist. Task 9 wires and re-emits the contract; Task 10 documents. A reviewer can accept after Task 7 for the API-only path and treat Task 8 as a fast-follow within the slice if the DNS onboarding lags.

## Self-review checklist

- [ ] No query crosses firms; bytes to R2, not D1; every read status-/access-gated.
- [ ] One parser (`@magna-carta/email`); no PostalMime, no second parse.
- [ ] Dedup converges (Message-ID and content-hash fallback); provenance never flattened.
- [ ] The "already filed" and "also on" reads never leak a walled matter (absence-not-existence).
- [ ] Attachments ride the existing chokepoint; nothing served inline-active; inline logos filtered.
- [ ] `directoryEntityId` written null; resolution deferred, not faked.
- [ ] Seams (conflict hook, notifications raise, dkim verdict) placed and called, bodies deferred.
- [ ] Contract re-emitted + client regenerated + conformance updated in one commit.
- [ ] Docs (user + white paper) and all fragments land in the same PR; full gate green.
