# email-filing-capture-slice-1

**Branch:** `claude/email-filing-capture-slice-1-h03vp5` · **Off:** main (014938a) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-17

## Scope

Email filing & capture — slice 1: the matter-email **record model** plus the **forward/CC capture** path. Builds the five per-firm tables (`email_message` / `email_thread` DAG / `email_matter_link` junction / `email_participant` / `email_attachment`), a new pure `@magna-carta/email-filing` package (dedup, thread DAG, record mapping, `captureEmail`), the firm-scoped data-access statements, the `emails:*` permission family, attachment extraction onto the existing ingest chokepoint, the authenticated `POST /api/v1/matters/{id}/emails` API entrance plus its read routes, and the `apps/email-worker` Cloudflare Email Worker forward/CC entrance.

Both entrances converge on one `captureEmail` over the already-built `@magna-carta/email` parser and the already-built `@magna-carta/file-manager` ingest/quarantine chokepoint.

Design (accepted 2026-07-16): [`docs/specs/2026-07-14-email-filing-record-and-forward-capture-design.md`](../specs/2026-07-14-email-filing-record-and-forward-capture-design.md) · Plan: [`docs/specs/2026-07-14-email-filing-record-and-forward-capture-implementation-plan.md`](../specs/2026-07-14-email-filing-record-and-forward-capture-implementation-plan.md)

In scope: the record model, forward/CC + API capture, Message-ID dedup with content-hash fallback, the wall-safe "already filed" read, multi-matter linking, attachment extraction as first-class quarantined File Manager documents, the verbatim-original R2 write, and the later-slice seams (conflict hook, notifications raise, DKIM verdict boundary).

Out of scope: the native add-in UI, mailbox sync, the DKIM verdict computation, ML matter-match, the correspondence-timeline UI, and auto-file rules — later slices; only their seams are placed here.

## Status

**Building.** Design accepted; executing Tasks 1–10.

Note: since the design's gate check, Directory address→entity resolution has merged to `main` (`findEntitiesByEmailAddress` in `packages/directory/src/contact-email.ts`), so participant resolution the design deferred (§6) is **wired now** rather than written null.

## Files expected to be touched

- `packages/email-filing/**` (new) — the pure record-model + capture-orchestration package
- `packages/database/src/per-firm-schema.ts` — five new tables (additive, appended)
- `packages/database/drizzle/per-firm/` + `apps/worker/src/per-firm-migrations.ts` — the records migration + the emails permissions seed migration
- `packages/data-access/src/email-filing-statements.ts` (new)
- `packages/access-control/src/registry.ts` — the `emails:*` namespace + role seed
- `apps/email-worker/**` (new) — the Cloudflare Email Worker forward/CC entrance
- `apps/worker/src/routes/emails.ts` (new), `apps/worker/src/emails/capture-consumer.ts` (new), `apps/worker/src/app.ts`, `apps/worker/src/wrangler.jsonc`, `apps/worker/test/firms.test.ts` (lineage-head bump)
- Generated, committed: `apps/worker/openapi/openapi.json`, `packages/api-client/src/*`
- `docs/user/features/filing-email-to-a-matter.md` (new), the white paper _Communications layer_ delta
- `ROADMAP.md`, `status.d/email-filing.md`, `changelog.d/`, `docs/decisions/pending/`, `docs/conventions/operations.md`

## Overlap notes

- **`packages/database/src/per-firm-schema.ts`** is shared — additive tables only, appended at the end; sync `main` before touching it.
- **Reads `packages/directory`, `packages/email`, `packages/file-manager` but does not write them.** Consumes `parseMessage`/`extractPart`, `runIngest`, and `findEntitiesByEmailAddress`.
- Adds a new per-firm migration and a new per-firm queue consumer — coordinate the migration lineage head (`apps/worker/test/firms.test.ts`) and `per-firm-migrations.ts` import map with any other in-flight migration stream before merge.
