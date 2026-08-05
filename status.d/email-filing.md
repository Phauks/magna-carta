---
slice: Email filing — record model & forward/CC capture
group: cross-cutting
order: 31
research: done
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: todo
load-profile: done by="Opus 4.8"
tested: done by="Opus 4.8"
branch: main
active-work:
next: The capture-address mint/rotate/revoke surface is built (emails:manageCaptureAddresses), so the forward/CC path now has its writer; the capture-subdomain DNS onboarding remains a deploy step. The DKIM verifier behind the placed seam is built (RFC 6376 over WebCrypto, DNS-over-HTTPS key lookup, verdict + reason + verified domain on the message row, informational only), and the file-to-matter API is hardened for the add-in (an honoured Idempotency-Key with the capture job derived from it, applied in the handler because the chokepoint's required-idempotency gate consumes a binary body, format and size guards through the ingest chokepoint's own policy, matter existence/access answered as absence, declared capture source, one shared size ceiling with the forward entrance). The add-in's client API is now complete on top of that seam: ranked matter suggestions (thread continuation, subject matter number, correspondent-to-matter-party, and a typed term delegated to the caseload search) narrowed to the matters the member can access before ranking, a capture-status readback that turns the filing job id into the record and link state the capture consumer recorded, and a member filing-context read (own recent filing targets, whether each has a live capture address, the firm catch-all, the capture zone, the size ceiling) — all bound to the existing emails:read, with one index-only migration behind the recent-filings walk. Remaining fast-follows — the native add-in CLIENT (Outlook/Gmail Save & File over that API — UI, owner-built), guardrailed auto-file rules (their DKIM-authenticated-sender guardrail now has its verdict, and the suggestion ranking now reports the ambiguity a rule must never fire through), and the matter correspondence timeline UI (deferred to the UI plan, and the surface where the verdict becomes visible). Participant resolution is wired live via the merged Directory reverse lookup.
link-spec: docs/specs/2026-07-14-email-filing-record-and-forward-capture-design.md
link-plan: docs/specs/2026-07-14-email-filing-record-and-forward-capture-implementation-plan.md
adrs:
blocked-by:
---

Slice 1 of the Email filing & capture subsystem: the matter-email record model (`email_message` / `email_thread` DAG / `email_matter_link` junction / `email_participant` / `email_attachment`) and the CASA-free forward/CC Email Worker capture, both converging on one `captureEmail` over the built `@magna-carta/email` parser and the built ingest/quarantine chokepoint. Also ships the authenticated `file this MIME to matter` API the later add-in slice posts to. Gate check (2026-07-14): the upload/quarantine pipeline (2·1) is green and directly reusable; Directory (1·3) is partial — the party graph + `matter_party` bridge are built but address→entity resolution is not, so participant resolution degrades gracefully and is deferred. The add-in, mailbox sync, conflict engine, DKIM verdict, and the correspondence-timeline UI are later slices; their seams are placed.
