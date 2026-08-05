# Communications Layer

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: communications
  name: Communications layer
  scope: Email, messaging (SMS/MMS/RCS), and voice/telephony unified behind one templating and trigger engine, all logged to the matter/Directory.
  status: partial
  adrs: ADR-0047
  evidence: Email parse engine, the transactional email adapter, and forward/CC email capture are shipped; messaging and voice ports, templates, and the trigger engine do not exist.

- id: communications.email
  name: Email
  scope: Dual send paths — firm's own mailbox for matter correspondence, transactional provider for billing/system mail — plus the in-house parse engine.
  status: partial
  evidence: Transactional adapter, parse core, and the forward/CC capture path are shipped; the firm-mailbox (Gmail/Outlook plugin) integration is still design-only.

- id: communications.email.transactional
  name: Transactional email adapter
  scope: Billing/system mail through a transactional provider adapter.
  status: shipped
  slices: 0-6-telemetry-baseline-platform-closeout
  adrs: ADR-0074, ADR-0100
  evidence: Email Service adapter shipped with slice 0-6 (status.d fragment); company account-of-record decided in ADR-0100.

- id: communications.email.filing
  name: Firm-mailbox email filing
  scope: Matter correspondence through the firm's own Gmail/Outlook mailbox via the email plugin, threaded in the mailbox and logged to the matter.
  status: partial
  slices: email-filing
  adrs: ADR-0200, ADR-0202
  spec: docs/specs/2026-06-16-email-filing-design.md
  evidence: packages/email-filing (record, thread, dedup, capture, capture-address, capture-token) + apps/worker/src/routes/capture-addresses.ts + emails.ts on main; capture-address mint, rotate, and revoke are built and the six email tables are classified in the PII registry.
  notes: Slice 1 is the record model plus forward/CC capture, functionally complete pending the deploy that activates the inbound route; the firm-mailbox Gmail/Outlook plugin path is not built.

- id: communications.email.filing.capture-addresses
  name: Capture-address management
  scope: Minting, rotating, and revoking the forward/CC capture address a matter files mail through, plus the firm's single catch-all address.
  status: shipped
  slices: email-filing
  adrs: ADR-0193, ADR-0202
  spec: docs/specs/2026-07-14-email-filing-record-and-forward-capture-design.md
  evidence: apps/worker/src/routes/capture-addresses.ts (six routes behind emails:manageCaptureAddresses) + packages/email-filing capture-address/capture-token + apps/worker/test/emails-capture-addresses.test.ts on main.
  notes: Backend and user guide only — no screens yet; a minted address becomes routable on the next per-firm outbox sweep, and the capture-subdomain DNS onboarding is still a deploy step.

- id: communications.email.filing.auto-file-rules
  name: Auto-file rules
  scope: Typed, matter-bound, revocable rules that route captured mail to a matter unattended, behind a fixed set of fail-closed guardrails and a staged-by-default consent posture.
  status: partial
  slices: email-filing
  spec: docs/specs/2026-08-05-auto-file-rules-design.md
  evidence: packages/database per-firm email_auto_file_rule + email_auto_file_decision and email_matter_link.auto_file_rule_id, packages/email-filing/src/auto-file-rules.ts (resolveAutoFileDecision), packages/data-access/src/email-auto-file-statements.ts, and the emails:manageAutoFileRules capability with its role seed.
  notes: Build slice 1 only — the rule model, the capability, and the pure guardrail decision. Nothing evaluates during a capture yet: the port on the capture core and the evidence gatherer in the consumer are the next slice, the management routes, review read, and load-profile numbers the one after. No screens.

- id: communications.email.parse-engine
  name: Email parse core
  scope: Pure-Rust .eml/.msg/mbox parse engine on the engine-host seam with WASM edge, wrapper package, and Email Inspector tool route.
  status: shipped
  slices: email-core-parse-engine
  spec: docs/specs/2026-07-09-email-core-parse-engine-design.md
  evidence: crates/email-core + packages/email on main, tested (status.d fragment); LZFu compressed-RTF decoder added (docs/specs/2026-07-10-lzfu-compressed-rtf-decoder-design.md, changelog.d/lzfu-compressed-rtf.md).
  notes: Parse-only; the communications capture subsystem builds on this record model later.

- id: communications.messaging
  name: Messaging (SMS/MMS/RCS)
  scope: CPaaS behind a messaging port serving outbound notifications, SMS 2FA, access codes, and two-way client texting.
  status: not-started
  adrs: ADR-0047
  evidence: Decision accepted; no messaging port, adapter, or schema on the tree.

- id: communications.messaging.port
  name: Messaging port
  scope: Swappable CPaaS adapter with per-firm scoped secrets.
  status: not-started
  slices: integration-port-system
  adrs: ADR-0047, ADR-0091
  evidence: Port system substrate shipped; no messaging port defined.

- id: communications.messaging.notifications
  name: Outbound notifications
  scope: Appointment/deadline/payment reminders and invoice/report-ready notices over messaging.
  status: not-started
  adrs: ADR-0059
  evidence: Notifications orchestration decided (ADR-0059); no messaging channel exists.

- id: communications.messaging.two-way-texting
  name: Two-way client texting
  scope: Inbound and outbound conversations threaded and logged to the matter/Directory.
  status: not-started
  adrs: ADR-0047
  evidence: Promoted from backlog by decision; no code.

- id: communications.messaging.sms-2fa
  name: SMS 2FA factor
  scope: SMS as an authentication second factor.
  status: not-started
  evidence: Auth foundation shipped (slice 0-4) without an SMS factor; no messaging rail to carry it.

- id: communications.messaging.rcs
  name: RCS enhancement
  scope: RCS as progressive enhancement over SMS/MMS with verified branded sender and auto-fallback.
  status: not-started
  adrs: ADR-0047
  evidence: Posture decided; no code.

- id: communications.messaging.compliance
  name: Messaging compliance
  scope: A2P 10DLC/toll-free/RCS-brand registration as procurement prerequisite; TCPA consent and STOP/HELP opt-out enforced in the port.
  status: not-started
  adrs: ADR-0047
  evidence: Requirements recorded in the decision; no registration workflow or enforcement code.

- id: communications.voice
  name: Voice and telephony
  scope: Inbound call handling behind a telephony port — recording to per-firm R2, media-stream fork, call log and transcript on the Directory/matter.
  status: not-started
  adrs: ADR-0047
  evidence: No telephony port or call-handling code.

- id: communications.voice.transcription
  name: In-house transcription
  scope: Call audio transcribed on Cloudflare Workers AI so privileged audio never egresses to the carrier.
  status: not-started
  slices: ai-inference-foundation
  evidence: No transcription pipeline; the Workers AI inference foundation (packages/inference) is the shipped substrate.
  notes: Same capability later serves preview transcript-sync and discovery/deposition media.

- id: communications.voice.consent
  name: Call-recording consent gating
  scope: Recording consent gated by the jurisdiction-profile machinery (one-party vs all-party states).
  status: not-started
  slices: 3-2-trust-accounting-jurisdiction-compliance
  evidence: Reuses the trust jurisdiction config, which is itself still in design; no consent gate exists.

- id: communications.voice.e911
  name: E911 posture
  scope: Emergency-calling registration if a real outbound office line is offered; a pure inbound intake line sidesteps it.
  status: deferred
  evidence: White paper records it as a latent decision/seam, explicitly not solved now.

- id: communications.telnyx
  name: Telnyx launch adapter
  scope: One vendor covering SMS/MMS/RCS plus voice with bidirectional media streaming and Ed25519-signed webhooks; Twilio/Bandwidth/Plivo as swaps.
  status: not-started
  adrs: ADR-0047
  evidence: Vendor decided; no adapter code.

- id: communications.templates-triggers
  name: Templates and trigger engine
  scope: Channel-aware templates feeding one automation/trigger engine; first automations are invoices/statements, payment reminders, scheduled reports and deadline reminders.
  status: not-started
  adrs: ADR-0059
  evidence: No template or trigger code; notifications orchestration decision is the design seam.

- id: communications.matter-logging
  name: Communication logging
  scope: All communication across all three channels logged to the matter/Directory under the redact-by-default telemetry discipline.
  status: not-started
  adrs: ADR-0017
  evidence: The redaction discipline is platform standard; no communications log exists because no channels are built.
