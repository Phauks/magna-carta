# Client Intake / CRM

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Client intake -->

- id: intake
  name: Client intake / CRM
  scope: Lead pipeline with stages feeding prospective matters, public intake forms capturing prospects into the Directory, receptionist call intake, and the per-matter-type intake procedure a consultation clears before it opens.
  status: partial
  slices: 6-4-intake-procedure
  spec: docs/specs/2026-08-15-client-intake-design.md
  evidence: The intake procedure shipped first (intake.procedure below): packages/intake, three per-firm tables, four permissions, twelve routes, the open-precondition hook on the matter shell, Settings · Intake Procedures and the matter's Intake section. The rest of the area — the submission, the public form, the pipeline board, call intake — is designed in docs/specs/2026-08-15-client-intake-design.md and unbuilt.
  audience: public
  public-name: Client intake
  public-summary: Take an enquiry, check it for conflicts, and turn it into a matter without typing anything twice.
  awaiting-owner: Does the first slice ship staff-entered intake only, with no public form at all? The intake procedure that shipped is staff-side and needs no anonymous surface; the design's recommendation (yes, staff-entered first) was taken for it, and the public form still waits on this answer plus its own flags. Client intake design flag J1.

- id: intake.procedure
  name: Intake procedure
  scope: A firm-authored, per-matter-type list of steps a consultation must clear before it opens, each answered by the subsystem that owns the fact or by a member's record, gating the open.
  status: shipped
  slices: 6-4-intake-procedure
  surface: screen
  spec: docs/specs/2026-09-03-intake-procedure-design.md
  evidence: packages/intake (procedure-service.ts, checklist.ts with the reader seam, record-service.ts, open-precondition.ts, readers/), the intake_procedure, intake_procedure_step and matter_intake_step_record tables, intake:read/record/waive/manageProcedures, apps/api-worker/src/routes/intake.ts, the openPreconditions hook in packages/matters/src/open-preconditions.ts threaded through openMatter, GET /api/v1/matters/{id}/open-readiness, /settings/intake-procedures, the matter's Intake section, and Requirements To Open in the status window.
  notes: Eight step kinds held by a CHECK. Conflicts, billing, document assembly, trust and custom fields answer their kinds today; identity verification and acknowledgement are a member's record until a subsystem exists, and adding the reader is the whole change. The checklist is derived on every read, never stored. A required step refuses the open; the override is a waiver under intake:waive with a rationale, append-and-flip. The platform seeds no procedure.

- id: intake.lead-pipeline
  name: Lead pipeline
  scope: Pipeline stages and lead lifecycle feeding prospective matters.
  status: not-started
  evidence: No lead entity or pipeline; stages and lifecycle are explicitly unspecified.
  awaiting-owner: Is the pipeline board visible to the whole firm, or per-attorney like the Consultations folder? A shared board is what an intake coordinator needs and what every competitor ships; the narrowing to per-attorney was a deliberate decision (ADR-0080), so widening it is a reversal only the owner can make. Client intake design flag J4.

- id: intake.public-forms
  name: Public intake forms
  scope: Workers-served public forms (fields, validation, spam control) landing submissions as Directory prospects plus prospective matters.
  status: not-started
  evidence: No form builder or public intake route exists. The bot control such a form would sit behind does: apps/api-worker/src/human-verification/ ships Turnstile server-side verification, gating registrations and invitation redemptions, and serves them unprotected while no secret is provisioned.
  awaiting-owner: Two things stand in front of an anonymous form. Whether it accepts attachments — the value is real (the contract, the letter they were served) and so is the surface, since it is an unidentified stranger writing into the untrusted-ingest and malware-scan pipeline at the firm's quarantine and storage cost. And whether Turnstile is switched on first: the verifier is built but dormant, and every unprotected pass is counted as unenforced rather than blocked, so a public form shipped ahead of the activation would ship in front of a bot control that is not actually running. Client intake design flags J3 and J11.

- id: intake.call-intake
  name: Receptionist call intake
  scope: Recorded, transcribed inbound calls turned into a Directory prospect plus prospective matter with the transcript attached.
  status: not-started
  evidence: Depends on the unbuilt voice/telephony port and transcription; no capture flow exists.

- id: intake.conflict-check
  name: Conflict check at intake
  scope: Prospects are conflict-checkable entities from first contact; intake triggers a conflicts check.
  status: partial
  slices: 6-4-intake-procedure
  surface: screen
  adrs: ADR-0013
  evidence: The check, its reporting posture, the event triggers, the re-check ledger and the cron backstop all shipped in packages/conflicts; the New Matter window runs a preliminary check on the client before the matter exists; and the intake procedure's conflicts-check step (packages/intake/src/readers/conflicts.ts) gates the open on the posture's four procedure facts — checked, at the floor, every hit answered, no re-check owed — concluding nothing about the client. What is missing is a prospect that can be checked before a matter exists and the submission flow in front of it.
  awaiting-owner: A professional-conduct question with a build attached: may a decline be recorded before a conflicts check has completed? A firm declining instantly on subject matter — we do not do that kind of work — should not be forced through a check; a firm declining because of a conflict must have the record. The two are indistinguishable to the platform at the moment of the click, so the answer decides whether the decline path gates on the check or merely notes its absence. Client intake design flag J5.

- id: intake.crm
  name: CRM fields and activities
  scope: CRM-style fields and activity tracking on prospects.
  status: not-started
  evidence: The fields half needs no engine — the targets in packages/custom-fields/src/types.ts are matter, entity and matterAsset, and the first two are exactly what a promoted lead is made of. The activity half has no substrate at all: the platform carries no note, comment or timeline entity on any record.

- id: intake.conversion
  name: Lead-to-matter conversion
  scope: Converting a prospect/prospective matter into an open matter.
  status: partial
  slices: 6-4-intake-procedure
  surface: screen
  adrs: ADR-0080
  evidence: Conversion is the shipped open transition in packages/matters/src/matter-service.ts, which draws the number in the matter's own atomic batch. The intake preconditions in front of it now exist: openPreconditions on the matter shell, the intake procedure's gate registered in apps/api-worker/src/routes/matters.ts, the open-readiness read, and Requirements To Open in the status window. What is missing is the pipeline it converts from and the engagement-letter and fee-agreement hand-offs as one act.
  notes: The design's flag J2 — hard refusal or override — was answered in the build as an override in the form of a waiver: a named member under intake:waive, a mandatory rationale, an audit row, and the record kept forever, which is the traced override the design refused to leave untraced.
