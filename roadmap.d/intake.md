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
  awaiting-owner: Does the first slice ship staff-entered intake only, with no public form at all? The whole mechanism — submission, triage, prospect entity, prospective matter, preliminary check, stage, comprehensive check, conversion — works with a receptionist typing into a screen, and shipped that way it needs no anonymous surface, no bot control, no rate-limit tuning and no disclosure analysis. The public form is an accelerant on a flow that has to exist either way, and answering this decides how much of the area is in the first slice. Client intake design flag J1.

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
  status: not-started
  adrs: ADR-0013
  evidence: The check, its reporting posture, the event triggers, the re-check ledger and the cron backstop all shipped in packages/conflicts, and the preliminary and comprehensive triggers in packages/conflicts/src/recheck-cause.ts are live rather than reserved — matter-service publishes matter.created and matter.opened to the outbox and the worker's consumer dispatch spreads RECHECK_CAUSE_TOPICS over them. What is missing is a prospect that can be checked before a matter exists, and the intake flow in front of it.
  awaiting-owner: A professional-conduct question with a build attached: may a decline be recorded before a conflicts check has completed? A firm declining instantly on subject matter — we do not do that kind of work — should not be forced through a check; a firm declining because of a conflict must have the record. The two are indistinguishable to the platform at the moment of the click, so the answer decides whether the decline path gates on the check or merely notes its absence. Client intake design flag J5.

- id: intake.crm
  name: CRM fields and activities
  scope: CRM-style fields and activity tracking on prospects.
  status: not-started
  evidence: The fields half needs no engine — the targets in packages/custom-fields/src/types.ts are matter, entity and matterAsset, and the first two are exactly what a promoted lead is made of. The activity half has no substrate at all: the platform carries no note, comment or timeline entity on any record.

- id: intake.conversion
  name: Lead-to-matter conversion
  scope: Converting a prospect/prospective matter into an open matter.
  status: not-started
  adrs: ADR-0080
  evidence: Conversion is the shipped open transition in packages/matters/src/matter-service.ts, which draws the number in the matter's own atomic batch; what is missing is the intake preconditions in front of it and the pipeline it converts from.
  awaiting-owner: A professional-conduct question rather than a product one. When the four conversion preconditions are unmet — an open re-check request among them — does opening the matter refuse outright, or proceed on an override with a recorded reason? The conditions are facts about the firm's own procedure rather than conclusions about the client, so gating on them concludes nothing; but a hard refusal will, at some point, stop a firm opening a matter on a day it needed to. The design refuses only to leave an override untraced. Client intake design flag J2.
