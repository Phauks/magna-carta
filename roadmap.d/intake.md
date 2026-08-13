# Client Intake / CRM

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Client intake -->

- id: intake
  name: Client intake / CRM
  scope: Lead pipeline with stages feeding prospective matters, public intake forms capturing prospects into the Directory, and receptionist call intake.
  status: not-started
  evidence: No intake package, forms, pipeline, or spec; the white paper flags the whole area needs-development with a follow-up spec required.
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
  evidence: Directory captures entities today, but no conflicts check exists to trigger.

- id: intake.crm
  name: CRM fields and activities
  scope: CRM-style fields and activity tracking on prospects.
  status: not-started
  evidence: Explicitly unspecified; the shipped custom-fields engine (packages/custom-fields) is a substrate only.

- id: intake.conversion
  name: Lead-to-matter conversion
  scope: Converting a prospect/prospective matter into an open matter.
  status: not-started
  adrs: ADR-0080
  evidence: The matter lifecycle already models consultation/prospective status (packages/matters), a shipped seam; no conversion flow from an intake pipeline exists.
