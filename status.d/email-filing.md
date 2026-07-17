---
slice: Email filing — record model & forward/CC capture
group: cross-cutting
order: 31
research: done
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: todo
ui: todo
load-profile: todo
tested: todo
branch: main
active-work:
next: Owner acceptance of the slice-1 design; then build Tasks 1-10 (record schema -> pure email-filing package -> statements -> emails:* permissions -> capture + attachments -> API entrance -> Email Worker forward path). The Directory address->entity resolution prerequisite is now BUILT and merged to main (directory_email write path + reverse findEntitiesByEmailAddress lookup + normalized-address index), so participant resolution can light up rather than stay deferred.
link-spec: docs/specs/2026-07-14-email-filing-record-and-forward-capture-design.md
link-plan: docs/specs/2026-07-14-email-filing-record-and-forward-capture-implementation-plan.md
adrs:
blocked-by:
---

Slice 1 of the Email filing & capture subsystem: the matter-email record model (`email_message` / `email_thread` DAG / `email_matter_link` junction / `email_participant` / `email_attachment`) and the CASA-free forward/CC Email Worker capture, both converging on one `captureEmail` over the built `@magna-carta/email` parser and the built ingest/quarantine chokepoint. Also ships the authenticated `file this MIME to matter` API the later add-in slice posts to. Gate check (2026-07-14): the upload/quarantine pipeline (2·1) is green and directly reusable; Directory (1·3) is partial — the party graph + `matter_party` bridge are built but address→entity resolution is not, so participant resolution degrades gracefully and is deferred. The add-in, mailbox sync, conflict engine, DKIM verdict, and the correspondence-timeline UI are later slices; their seams are placed.
