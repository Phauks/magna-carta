---
branch: claude/email-add-in-client-api
worktree: .claude/worktrees/agent-a5eb32367738df671
area: email filing — the mail-client add-in's backend client API
status: building
touches: packages/email-filing/src/matter-suggestion.ts, packages/email-filing/src/index.ts, packages/data-access/src/email-filing-statements.ts, packages/database/drizzle/per-firm/ (one index-only migration + snapshot), apps/worker/src/routes/email-add-in.ts, apps/worker/src/emails/capture-consumer.ts, apps/worker/src/app.ts, apps/worker/test/, apps/worker/openapi/openapi.json, packages/api-client/, changelog.d/, status.d/email-filing.md, docs/user/features/filing-email-to-a-matter.md
---

Completes the mail-client add-in's **backend** surface over the seam the DKIM/add-in
hardening work left: the add-in UI itself is the owner's, this stream ships only the API
it will call.

## Scope

- **Choosing where to file** — one ranked matter-candidate endpoint: thread continuation,
  subject matter-number, and participant-to-matter-party signals, plus an optional free-text
  term delegated to the existing `listMatters` query. Every candidate passes the ethical-wall
  access filter.
- **Filing and reading the result back** — the capture status readback for the job id the
  existing file-to-matter POST already returns. The capture consumer now records its outcome
  on the idempotency record it already writes, so no new table appears.
- **What the add-in shows the signed-in member** — recent filing targets, each annotated with
  whether a live forward/CC capture address exists, plus the firm catch-all. Tokens stay
  write-once: previews only, never the credential.

## Out of scope (deliberate)

- Auto-file rules — a later slice; no rule storage and no rule evaluation here.
- Any UI (the add-in pane, the correspondence timeline).

## Notes for concurrent streams

- Adds one **index-only** per-firm migration on `email_matter_link (linked_by, created_at, id)`
  — assumed journal tail idx 29 = `20260805T150000_custodian-stocktake`, so this is idx 30.
  A stream that lands a per-firm migration first forces a renumber here.
- Moves the contract: `apps/worker/openapi/openapi.json` + the generated api-client are
  re-emitted in the same commit. Second-to-merge regenerates.
