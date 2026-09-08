---
slice: 6·7 — The public intake form (the builder, the anonymous page, the submissions queue) and the human-verification widget
group: phase-6
order: 7
research: n/a
spec: done
plan: done
built: done
ui: done
load-profile: todo
tested: done
branch: claude/forms-concept-research-3ibnhx
active-work: docs/active-work/claude/forms-concept-research-3ibnhx.md
next: attachments once flag J3 lands; reading an enquiry against contacts the firm already holds, so accepting cannot silently make a duplicate; the load-profile volume for the queue read; the joining screens taking the same verification widget
link-spec: docs/specs/2026-09-07-public-intake-form-design.md
link-plan: docs/specs/2026-09-07-public-intake-form-design.md
adrs:
blocked-by:
---

A firm authors a form, publishes it, and hands out its link; a stranger opens the link, fills it in, and the firm reads what arrived. `@magna-carta/intake-forms` ships four per-firm tables — `intake_form`, `intake_form_version`, `intake_form_field`, `intake_form_submission` — under two permissions that split genuinely different capabilities: `intakeForms:manage` (Owner/Admin, because publishing puts a page on the internet under the firm's name) and `intakeForms:readSubmissions` (Owner/Admin, Attorney, Paralegal, because clearing the queue is reception's daily job).

**The anonymous half is the only place in this platform where an unauthenticated caller reaches a firm's own database**, and it is arranged around one rule: every outcome that is not about the caller's own budget or challenge answers identically. A wrong token, a form still in draft, a form the firm closed and a firm that does not exist all answer one 404 with one body; a name the firm already represents and a stranger both answer 202. It is enforced by construction — the resolver filters on status inside its SQL, and the submission path performs no lookup against firm data at all, because a read whose duration varies with what the visitor typed hands a probing script an oracle from the clock. Nothing on that path creates a person, an organization, a matter or an intake, which is what keeps a spam run out of the corpus whatever gets past the rate limit.

**How an anonymous request reaches a firm database:** the URL carries both halves, `/enquiry/{firmId}/{token}`, and the route addresses the `FirmDatabase` Durable Object by the id in its own path — the seam the queue consumers and the cron already use with no session. A firm-chosen vanity path is a global namespace per-firm databases cannot enforce uniqueness over, so it stays additive; the token is separate from the form id because it is rotatable, which is what a firm needs when a link has been scraped.

**A published version freezes.** Fields hang from a version and a submission names the version it arrived through, so a firm that reworded a question still reads old answers under the wording they were actually asked. Editing a published form opens a new draft seeded with a copy rather than rewriting what people answered.

The human-verification widget (`apps/web/src/lib/human-verification/human-verification-widget.svelte`) is the browser half the activation order has been waiting on since 2026-08-15, and the site key is served by the form's own public read rather than baked into the SPA — so switching verification on is setting two values on the worker, with no rebuild of the interface. Absent, the page renders no challenge at all rather than a box that verifies nothing.

**Accepting is the one decision that writes, and it is propose-and-confirm.** The owner's framing settled the shape: a form is a vector for somebody outside the firm to put information in, and what arrives is verified by a person before it becomes a record. `GET .../acceptance-proposal` maps the answers onto the record a member would create and commits nothing; `POST .../acceptance` writes the Directory entity, the intake and the client party link in ONE batch from what the member confirmed — one batch because the Directory is soft-delete only and a merged-away alias stays in the corpus, so an entity written by a sequence that then failed to write its matter would be in the firm's permanent conflicts corpus forever with nothing to show for it. The review sheet keeps what the visitor actually wrote on screen beside the fields being corrected, because hiding it would hide the thing being checked.

Wiring that screen found two defects in the triage operation, which predated acceptance: `accepted` was still a state a bare state string could write (leaving rows that claim a matter exists with nothing to point at), and triaging an already-accepted submission hit the row's own CHECK and answered a member with an Error ID. Triage now takes `declined` and `spam` only, and refuses any decision on an accepted submission with a 409.

`lint:back-navigation` gained the builder form of a back target: a screen whose parent is one record cannot name a constant, and before this such a screen read as having no way back at all.
