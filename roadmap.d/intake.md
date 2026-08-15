# Client Intake / CRM

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Client intake -->

- id: intake
  name: Client intake / CRM
  scope: Lead pipeline with stages feeding prospective matters, public intake forms capturing prospects into the Directory, and receptionist call intake.
  status: not-started
  evidence: No intake package, forms, or pipeline. The follow-up spec the white paper asked for is written (docs/specs/2026-08-15-client-intake-design.md) and is Proposed pending owner flags, so nothing here moves off not-started and no node carries a spec key yet.
  audience: public
  public-name: Client intake
  public-summary: Take an enquiry, check it for conflicts, and turn it into a matter without typing anything twice.

- id: intake.lead-pipeline
  name: Lead pipeline
  scope: Pipeline stages and lead lifecycle feeding prospective matters.
  status: not-started
  evidence: No lead entity or pipeline; stages and lifecycle are explicitly unspecified.

- id: intake.public-forms
  name: Public intake forms
  scope: Workers-served public forms (fields, validation, spam control) landing submissions as Directory prospects plus prospective matters.
  status: not-started
  evidence: No form builder or public intake route exists.

- id: intake.call-intake
  name: Receptionist call intake
  scope: Recorded, transcribed inbound calls turned into a Directory prospect plus prospective matter with the transcript attached.
  status: not-started
  evidence: Depends on the unbuilt voice/telephony port and transcription; no capture flow exists.

- id: intake.conflict-check
  name: Conflict check at intake
  scope: Prospects are conflict-checkable entities from first contact; intake triggers a conflicts check.
  status: not-started
  adrs: ADR-0013
  evidence: The check, its reporting posture, the event triggers, the re-check ledger and the cron backstop all shipped in packages/conflicts, and its trigger catalog already carries the preliminary and comprehensive names nothing yet calls; what is missing is the intake flow that would fire them.

- id: intake.crm
  name: CRM fields and activities
  scope: CRM-style fields and activity tracking on prospects.
  status: not-started
  evidence: The fields half needs no engine — packages/custom-fields targets matter and entity, which is exactly what a promoted lead is made of. The activity half has no substrate at all: the platform carries no note, comment or timeline entity on any record.

- id: intake.conversion
  name: Lead-to-matter conversion
  scope: Converting a prospect/prospective matter into an open matter.
  status: not-started
  adrs: ADR-0080
  evidence: Conversion is the shipped open transition in packages/matters/src/matter-service.ts, which draws the number in the matter's own atomic batch; what is missing is the intake preconditions in front of it and the pipeline it converts from.
