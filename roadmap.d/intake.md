# Client Intake / CRM

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Client intake -->

- id: intake
  name: Client intake / CRM
  scope: The intake desk over the matter lifecycle's first two rungs (intake, then consultation), a lead pipeline with stages, public intake forms capturing prospects into the Directory, receptionist call intake, and the per-matter-type intake procedure a consultation clears before it opens.
  status: partial
  slices: 6-4-intake-procedure, 6-5-intake-desk
  spec: docs/specs/2026-08-15-client-intake-design.md
  evidence: The intake procedure shipped first (intake.procedure below), then the desk (intake.desk): the sidebar's Intake destination at apps/web/src/routes/(app)/intake, packages/intake/src/desk.ts behind GET /api/v1/intake/consultations, the New Matter window's intake purpose, Schedule through the calendar's event window, and the directory picker that records a caller in place (apps/web/src/lib/directory/directory-entity-picker.svelte). The rest of the area — the submission, the public form, the pipeline board over stages, call intake — is designed in docs/specs/2026-08-15-client-intake-design.md and unbuilt.
  audience: public
  public-name: Client intake
  public-summary: Take an enquiry, check it for conflicts, and turn it into a matter without typing anything twice.

- id: intake.procedure
  name: Intake procedure
  scope: A firm-authored, per-matter-type list of steps a consultation must clear before it opens, each answered by the subsystem that owns the fact or by a member's record, gating the open.
  status: shipped
  slices: 6-4-intake-procedure
  surface: screen
  spec: docs/specs/2026-09-03-intake-procedure-design.md
  evidence: packages/intake (procedure-service.ts, checklist.ts with the reader seam, record-service.ts, open-precondition.ts, readers/), the intake_procedure, intake_procedure_step and matter_intake_step_record tables, intake:read/record/waive/manageProcedures, apps/api-worker/src/routes/intake.ts, the openPreconditions hook in packages/matters/src/open-preconditions.ts threaded through openMatter, GET /api/v1/matters/{id}/open-readiness, /settings/intake-procedures, the matter's Intake section, and Requirements To Open in the status window.
  notes: Ten step kinds held by a CHECK. Conflicts, billing, document assembly, trust and custom fields answer their kinds today; identity verification, the client's online forms, a payment and an acknowledgement are a member's record until a subsystem exists, and adding the reader is the whole change. The checklist is derived on every read, never stored. A required step refuses the open; the override is a waiver under intake:waive with a rationale, append-and-flip. The platform seeds no procedure.

- id: intake.desk
  name: Intake desk
  scope: The sidebar's Intake: every intake in flight, firm-wide, with who it is for, who carries it and how far it is against the procedure; starting one; resuming one; scheduling the consultation once the intake is complete.
  status: shipped
  slices: 6-5-intake-desk
  surface: screen
  spec: docs/specs/2026-09-05-intake-desk-design.md
  evidence: packages/intake/src/desk.ts and GET /api/v1/intake/consultations (apps/api-worker/src/routes/intake.ts, intake:read, cursor-paged, capped at fifty), apps/web/src/routes/(app)/intake/+page.svelte over apps/web/src/lib/intake/intake-desk.ts, the intake purpose of apps/web/src/lib/matters/new-matter-dialog.svelte, the seeded title and participants of apps/web/src/lib/calendar/record-event-dialog.svelte, and the shipped Intake row in apps/web/src/lib/navigation/destinations.ts.
  notes: An intake in flight is a matter in the intake status, the first rung of the lifecycle (owner's ruling, 2026-09-05: intake -> consultation -> open -> closed, the second rung renamed from prospective; a hold rung beside open followed on 2026-09-06); the desk lists intakes and consultations and adds no table. The desk is firm-wide (the wider design's flag J4, answered by the owner's workflow); the per-attorney Consultations view is unchanged. Complete Intake is the graduation step: refused with the reason while a required step is outstanding, it draws the consultation number through POST /api/v1/matters/{id}/graduate; Schedule follows on a consultation. The row states counts, never a verdict.

- id: intake.lead-pipeline
  name: Lead pipeline
  scope: Pipeline stages and lead lifecycle feeding intakes.
  status: not-started
  evidence: No stage entity or board. The desk (intake.desk) lists every intake in flight and how far it is against the procedure, which answers the question a board would until a firm needs a word the procedure cannot express. The visibility question is settled: the desk is firm-wide.

- id: intake.public-forms
  name: Public intake forms
  scope: Workers-served public forms (fields, validation, spam control) landing submissions as Directory prospects plus intakes.
  status: shipped
  surface: screen
  slices: 6-7-public-intake-form
  spec: docs/specs/2026-09-07-public-intake-form-design.md
  evidence: packages/intake-forms with four per-firm tables (intake_form, intake_form_version, intake_form_field, intake_form_submission), the intakeForms.\* routes in apps/api-worker/src/routes/intake-forms.ts behind intakeForms:manage and intakeForms:readSubmissions, and three screens plus the anonymous page — /forms, /forms/{id}, /forms/{id}/submissions, and /enquiry/{firmId}/{token} outside the app shell. The anonymous pair carries surface public with the auth rate-limit bucket and reaches the firm through firmDatabaseFor by the id in its own path, since there is no session to resolve one from. The human-verification widget it renders (apps/web/src/lib/human-verification/human-verification-widget.svelte) is the browser half the joining screens were blocked on.
  notes: Shipped ahead of the portal's client forms on the owner's 2026-09-07 answer — those need an external principal type, a PortalGrant and an amendment to ADR-0036's closed capability set, none of which exists, while the form definition and its builder are the one component both halves share and are built here. Built WIDGET-FIRST for the same day's second answer: the only anonymous surface with no legacy client to break, so it renders the challenge from its first commit and produces the browser component /register and the redemption screen have been blocked on since 2026-08-15 (docs/deploy-queue.md, step 1 of the activation order). Three things the design names as deliberately out: attachments (flag J3), turning an accepted submission into a directory record and an intake, and a firm-chosen vanity path — the public URL carries the firm handle and a rotatable per-form token, so nothing global is stored and an alias stays additive.
  awaiting-owner: One thing stands in front of an anonymous form: whether it accepts attachments. The value is real (the contract, the letter they were served) and so is the cost, since it is an unidentified stranger writing into the untrusted-ingest and malware-scan pipeline at the firm's quarantine and storage expense. A form without attachments is shippable and attachments are additive, so this decides the slice's scope rather than its start. Client intake design flag J3.

- id: intake.call-intake
  name: Receptionist call intake
  scope: Recorded, transcribed inbound calls turned into a Directory prospect plus an intake with the transcript attached.
  status: not-started
  evidence: Depends on the unbuilt voice/telephony port and transcription; no capture flow exists.

- id: intake.conflict-check
  name: Conflict check at intake
  scope: Prospects are conflict-checkable entities from first contact; intake triggers a conflicts check.
  status: partial
  slices: 6-4-intake-procedure
  surface: screen
  adrs: ADR-0013
  evidence: The check, its reporting posture, the event triggers, the re-check ledger and the cron backstop all shipped in packages/conflicts; the New Matter window — now also the desk's New Intake — runs a preliminary check on the client before the matter exists, and the client can be recorded into the directory from that field; and the intake procedure's conflicts-check step (packages/intake/src/readers/conflicts.ts) gates the open on the posture's four procedure facts — checked, at the floor, every hit answered, no re-check owed — concluding nothing about the client. What is missing is the anonymous submission flow in front of the desk.
  awaiting-owner: A professional-conduct question with a build attached: may a decline be recorded before a conflicts check has completed? A firm declining instantly on subject matter — we do not do that kind of work — should not be forced through a check; a firm declining because of a conflict must have the record. The two are indistinguishable to the platform at the moment of the click, so the answer decides whether the decline path gates on the check or merely notes its absence. Client intake design flag J5.

- id: intake.crm
  name: CRM fields and activities
  scope: CRM-style fields and activity tracking on prospects.
  status: not-started
  evidence: The fields half needs no engine — the targets in packages/custom-fields/src/types.ts are matter, entity and matterAsset, and the first two are exactly what a promoted lead is made of. The activity half has no substrate at all: the platform carries no note, comment or timeline entity on any record.

- id: intake.conversion
  name: Lead-to-matter conversion
  scope: Converting a consultation into an open matter.
  status: partial
  slices: 6-4-intake-procedure
  surface: screen
  adrs: ADR-0080
  evidence: Conversion is the shipped open transition in packages/matters/src/matter-service.ts, which draws the number in the matter's own atomic batch. The intake procedure now gates the rung before it: graduateMatter (intake -> consultation) behind graduatePreconditions, POST /api/v1/matters/{id}/graduate and its readiness read, and Requirements To Complete Intake in the status window; a consultation opens on the firm's decision. What is missing is the pipeline it converts from and the engagement-letter and fee-agreement hand-offs as one act.
  notes: The design's flag J2 — hard refusal or override — was answered in the build as an override in the form of a waiver: a named member under intake:waive, a mandatory rationale, an audit row, and the record kept forever, which is the traced override the design refused to leave untraced.
