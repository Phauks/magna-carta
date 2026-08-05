# claude/email-filing-fast-follows

**Branch:** `claude/email-filing-fast-follows` · **Started:** 2026-08-05 · **Status:** building

## Scope

Two named fast-follows on the merged email-filing slice (record model, forward/CC capture, the
capture-address mint/rotate/revoke surface): the **DKIM verifier behind the placed seam**, and the
**hardening of the authenticated file-to-matter API** the native add-in slice will post to.

**DKIM verifier.** The parse engine records DKIM-Signature / Authentication-Results / Received
verbatim with no verdict, and the record model already carries `email_message.dkim_verdict` defaulted
to `unverified`. This stream fills it: an RFC 6376 verifier in `@magna-carta/email-filing` (pure
TypeScript over WebCrypto — no new dependency, no C/C++, and the parse engine keeps its parse-only
boundary), a DNS-over-HTTPS public-key resolver supplied by the worker, and the verdict written on the
message row at capture time. It degrades rather than fails: unsigned mail, a `.msg` capture with no
raw MIME, a selector whose key has rotated away, and a DNS blip each record a distinct reason instead
of a bare pass/fail. The verdict is informational feedback, never a silent filter — nothing is
dropped, quarantined, or auto-filed on the strength of it.

**Add-in API hardening.** `POST /api/v1/matters/{matterId}/emails` is the endpoint the add-in's
"Save & File" posts to, and the add-in is expected to queue and retry. The endpoint gains: an honoured
`Idempotency-Key` with the capture job derived from it (a retry converges on one capture rather than
staging a second) — applied in the handler rather than through the chokepoint's required-idempotency
gate, which fingerprints by reading the body through Hono's text cache and would hand a binary `.msg`
back UTF-8-mangled; a size guard on the bytes actually received rather than a declared
`Content-Length`; a format/media-type guard through the File Manager's existing upload policy so a
non-email body is refused at the entrance instead of dead-lettering in the consumer; a matter
existence/access check answering the 404 the contract already declared; an explicit capture-source
parameter so an add-in capture records `addin` provenance rather than being indistinguishable from a
manual upload; and one shared capture size ceiling with the forward/CC entrance.

## Files touched

New:

- `packages/email-filing/src/dkim.ts` — the RFC 6376 verifier (tag parsing, simple/relaxed
  canonicalization, body hash, signature verification over WebCrypto, the DNS key-record port).
- `packages/email-filing/src/message-format.ts` — the shared message sniff (`eml` / `msg` /
  `unknown`), the media types, and the one capture size ceiling both entrances bound to.
- `packages/email-filing/test/dkim.test.ts`, `packages/email-filing/test/message-format.test.ts`.
- `apps/worker/src/emails/dkim-dns-resolver.ts` + `apps/worker/test/dkim-dns-resolver.test.ts` — the
  DNS-over-HTTPS `_domainkey` TXT lookup and its answer classification.
- `packages/database/drizzle/per-firm/20260805T120000_email-message-dkim-verdict.sql`.
- `changelog.d/email-filing-dkim-and-addin-hardening.md`,
  `docs/decisions/pending/email-dkim-verdict-informational.md`,
  `docs/decisions/pending/binary-body-route-idempotency.md`.

Changed:

- `packages/email-filing/src/capture.ts`, `src/record.ts`, `src/seams.ts`, `package.json` — the
  verdict port and its record mapping; the seam comment now names the verifier that fills it.
- `packages/database/src/per-firm-schema.ts` — `email_message.dkim_verdict_reason` +
  `dkim_verified_domain`.
- `packages/data-access/src/email-filing-statements.ts` — the two columns written and read.
- `apps/worker/src/routes/emails.ts` — the capture-entrance hardening and the verdict on the read.
- `apps/worker/src/emails/capture-consumer.ts` — the verifier wired to the resolver.
- `apps/worker/src/per-firm-migrations.ts` — the new migration bundled into the worker.
- `apps/worker/src/app.ts` — the optional `DKIM_RESOLVER_URL` binding.
- `apps/email-worker/src/index.ts` — the shared ceiling.
- `apps/worker/openapi/openapi.json`, `packages/api-client/src/**` — regenerated.
- `packages/data-access/src/pii-registry.ts` — why the new columns resolve to no data subject.
- `apps/worker/test/emails-routes.test.ts`,
  `packages/data-access/test/email-filing-statements.test.ts`, `apps/worker/CLAUDE.md`,
  `status.d/email-filing.md`, `docs/user/features/filing-email-to-a-matter.md`.

## Overlaps

`apps/worker/` is declared by the two custodian streams, but in different subsystems (`custody`,
`packages/custodian`) — no shared file. `packages/database/` is likewise declared by those streams;
this change is one migration file plus two columns on `email_message`, a table no other stream
touches. `changelog.d/` and `status.d/` are append-only fragment directories, and
`status.d/email-filing.md` is this subsystem's own fragment.

## What is not covered

The native add-in client (Outlook/Gmail manifests, Office.js, CardService) is its own slice — this is
server-side only. Auto-file rules are still not built: the DKIM-authenticated-sender guardrail they
depend on now has its verdict, but the rule engine itself remains a fast-follow. The verdict is not
yet surfaced in any UI (the correspondence timeline is deferred to the UI plan); it rides the message
read contract so the UI slice has it.
