# api-worker routes/files — CLAUDE.md

**Purpose.** The File Manager's metadata, upload, download and scan surfaces, and the matter-less file tools (type, integrity, repair, OCR, AI detection, decryption, password recovery). One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and the rules below are this surface's own. The Worker-wide rules (the chokepoint, the seam, the fitness tests) are in [`../../../CLAUDE.md`](../../../CLAUDE.md); the design is [`docs/specs/2026-09-18-api-worker-domain-modules-design.md`](../../../../../docs/specs/2026-09-18-api-worker-domain-modules-design.md).

## Upload readiness — the diagnosis for the one hop the Worker cannot see

`src/files/upload-readiness.ts` answers "can this firm upload?" from the server. The browser's
presigned PUT bypasses every Worker (it must: the request-body cap forbids proxying bytes), so a
refusal there reaches no log and the file manager can only say storage did not answer — while five
different faults produce that one symptom. `verifyUploadReadiness` checks each precondition where a
failure has a status code, in the order they must hold, and the report is the diagnosis:
`bucket-recorded`, `bucket-exists`, then the three settings the provisioner owns
(`event-notifications`, `lifecycle-rules`, `cors-policy` — **re-applied**, not diffed, because a
whole-set PUT costs what a read costs and leaves the bucket right), then `key-can-sign` — a signed
HEAD for an object that does not exist, made through `resolveFirmBucket` so it carries exactly the
credential a presigned URL carries; 404 is the affirmative answer, 403 the signature of a token
scoped to one bucket. `POST /api/v1/firm/upload-readiness` (`routes/files/upload-readiness.ts`,
`firm:manageScanPolicy`, audited) runs it from the version panel (the chip at the top right), with the other reads about what is running; the report is the panel's _Upload readiness_ section there.

Rules for this surface:

- **The report never says `ok` for a thing it did not look at.** Under the development adapter
  the account checks are `not-applicable`, stated as such; the provider's `kind` is the fact the
  report reads, never an inference from calls that all succeeded.
- **It repairs what is idempotent and names what is not.** A missing bucket is reported with the
  cause (the development adapter) and is NOT created — a sweep that creates buckets the provisioner
  should have would hide the fault it exists to expose. A mis-scoped key is reported with the
  re-mint.
- **The other half is the deploy gate, not code.** `wrangler.jsonc` requires
  `CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER` and `CLOUDFLARE_ACCOUNT_ID`, so a deployment cannot run
  the development adapters against real firms; there is deliberately no mode object, no daily
  sweep and no cached readiness on the firm row.
