# Communications Layer

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Communications -->

- id: communications
  name: Communications layer
  scope: Email, messaging (SMS/MMS/RCS), and voice/telephony unified behind one templating and trigger engine, all logged to the matter/Directory.
  status: partial
  adrs: ADR-0047
  evidence: Two channels now have code. Email has the parse engine, transactional adapter, forward/CC capture, auto-file rules and the add-in's server routes. Calls and texts have a record, a firm-scoped read and two screens (packages/communications, apps/api-worker/src/http/routes/communications/communications.ts, apps/web/src/routes/(app)/messaging) — but only the hand-logging producer: no port, no adapter and nothing sent or received. Voice beyond the log has no code, and there is no template or trigger engine of any kind.

- id: communications.email
  name: Email
  scope: Dual send paths — firm's own mailbox for matter correspondence, transactional provider for billing/system mail — plus the in-house parse engine.
  status: partial
  evidence: Transactional adapter, parse core and the forward/CC capture path are shipped, and so is the server half of the mail-client add-in (apps/api-worker/src/http/routes/email/email-add-in.ts). What is not built is the add-in itself — no manifest, no pane, no client — and no OAuth connection to a firm's Gmail or Outlook mailbox.
  audience: public
  public-name: Email filed to the matter
  public-summary: Send and receive client email from the firm's address and have each message filed against the right matter.

- id: communications.email.transactional
  name: Transactional email adapter
  scope: Billing/system mail through a transactional provider adapter.
  status: shipped
  surface: internal
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
  evidence: packages/email-filing (record, thread, dedup, capture, capture-address, capture-token, plus dkim.ts and matter-suggestion.ts) + apps/api-worker/src/http/routes/email/capture-addresses.ts and emails.ts on main; capture-address mint, rotate and revoke are built, and all eight email tables are classified in packages/data-access/src/pii-registry.ts — four carrying personal data (email_message, email_participant, email_matter_link, email_auto_file_rule) and four registered as carrying none.
  notes: Slice 1 is the record model plus forward/CC capture, functionally complete pending the deploy that activates the inbound route. The add-in's server surface has landed since — three routes in apps/api-worker/src/http/routes/email/email-add-in.ts answering the questions a Save-and-File pane asks that the matter-rooted routes do not (where should this go, what happened to what I filed, what do I show this member), with the suggestion ranking narrowed to matters the member may see before it is hydrated, so a walled matter contributes no suggestion, no reason and no count. The add-in client and the mailbox OAuth connection are still unbuilt.

- id: communications.email.filing.capture-addresses
  name: Capture-address management
  scope: Minting, rotating, and revoking the forward/CC capture address a matter files mail through, plus the firm's single catch-all address.
  status: shipped
  surface: awaiting-screen
  slices: email-filing
  adrs: ADR-0193, ADR-0202
  spec: docs/specs/2026-07-14-email-filing-record-and-forward-capture-design.md
  evidence: apps/api-worker/src/http/routes/email/capture-addresses.ts (six routes behind emails:manageCaptureAddresses) + packages/email-filing capture-address/capture-token + apps/api-worker/test/emails-capture-addresses.test.ts on main.
  notes: Backend and user guide only — no screens yet; a minted address becomes routable on the next per-firm outbox sweep, and the capture-subdomain DNS onboarding is still a deploy step.

- id: communications.email.filing.auto-file-rules
  name: Auto-file rules
  scope: Typed, matter-bound, revocable rules that route captured mail to a matter unattended, behind a fixed set of fail-closed guardrails and a staged-by-default consent posture.
  status: shipped
  surface: awaiting-screen
  slices: email-filing
  spec: docs/specs/2026-08-05-auto-file-rules-design.md
  evidence: apps/api-worker/src/http/routes/email/auto-file-rules.ts (eight operations, emails.createAutoFileRule through emails.autoFileReview, all present in apps/api-worker/openapi/openapi.json) + apps/api-worker/src/http/routes/firm/auto-file-policy.ts; packages/email-filing/src/auto-file-rules.ts (resolveAutoFileDecision) reached from apps/api-worker/src/emails/auto-file-evaluation.ts through the capture consumer; packages/data-access/src/email-auto-file-statements.ts; per-firm email_auto_file_rule + email_auto_file_decision + email_matter_link.auto_file_rule_id and its partial index; emails:manageAutoFileRules seeded to Owner/Admin and Attorney only, which apps/api-worker/test/emails-auto-file-rules-routes.test.ts exercises by refusing a Paralegal the writes and allowing the read.
  awaiting-owner: Whether a correspondent rule may ask to FILE outright when it was authored from a typed address rather than learned from a filing. The design wants a rule to inherit an authorizing act a person actually performed, and a directly-authored rule has none — its audit terminates in a configuration screen. Built permissive because the design also names the abstract editor, and the exposure is narrow (an unattended firing still needs the firm ceiling raised, the member's own matter access re-checked at every fire, and an intact-original capture with a passing signature on a matching domain, so a correspondent rule can never fire on the forward or catch-all path at all). The question is whether promotion `file` should additionally require created_from_email_message_id.
  notes: Complete end to end with no screens. Until the management routes landed nothing in the product created a rule — the create statement's only caller was a test — so the engine evaluated an empty candidate set on every unrouted capture; a rule can now be created from a filing, re-postured, suspended, resumed and revoked, and the firm can read one message's decision history and a thirty-day per-rule review. Refusals are at creation rather than at fire time: a rule asking to file under a lowered firm ceiling is rejected outright, and a thread rule is rejected unless its conversation is already filed to the named matter. The circuit-breaker thresholds are a per-firm setting with the shipped numbers as defaults, bounded so the protection cannot be configured away. Measured: ten thousand rules cost no more per capture than ten; the breaker's read stays at its cap after two hundred firings; the thread read grows with the conversation (0.06 ms at eight messages, 1.9 ms at two thousand), which is narrower than the design's flat-cost sentence and is recorded in packages/fixtures/src/load-profile/auto-file-measurements.test.ts. The matterNumberInSubject firm toggle is deliberately not built.

- id: communications.email.parse-engine
  name: Email parse core
  scope: Pure-Rust .eml/.msg/mbox parse engine on the engine-host seam with WASM edge, wrapper package, and Email Inspector tool route.
  status: shipped
  surface: awaiting-screen
  slices: email-core-parse-engine
  spec: docs/specs/2026-07-09-email-core-parse-engine-design.md
  evidence: crates/email-core (eml.rs, msg.rs, mbox.rs behind the wasm.rs edge) with packages/email as the wrapper, on main and tested per its status fragment; the LZFu decoder for a .msg's compressed RTF body is crates/email-core/src/lzfu.rs (docs/specs/2026-07-10-lzfu-compressed-rtf-decoder-design.md).
  notes: Parse-only; the communications capture subsystem builds on this record model later.

- id: communications.messaging
  name: Messaging (SMS/MMS/RCS)
  scope: CPaaS behind a messaging port serving outbound notifications, SMS 2FA, access codes, and two-way client texting.
  status: partial
  adrs: ADR-0047
  spec: docs/specs/2026-09-07-call-and-text-log-design.md
  evidence: The LOG exists and the carrier does not. A text is recorded, read, corrected, filed onto a matter, taken back off and set aside as belonging to no matter (packages/communications + the communication table + apps/api-worker/src/http/routes/communications/communications.ts), and it reaches the matter's Messaging section, the matter's consolidated search and its activity timeline. What is absent is the whole sending half — no messaging port, no adapter, no A2P 10DLC registration — so nothing leaves or arrives.
  audience: public
  public-name: Text messaging
  public-summary: Text a client from a firm number and keep the whole thread on the matter.
  notes: The owner's ruling of 2026-09-07 settled what the sidebar's Messaging row means — calls and texts, not email and not portal messages — and settled the anchor: a conversation may sit on an intake or a consultation, which carry no matter number, so every read and every picker turns on the matter's STATUS rather than its number. Their reviews of 2026-09-08 settled the rest of the screen: two kinds rather than three (a picture is something a text carries), one description for both, the number's own country beside it, a record that opens and can be corrected, and a reason a call may belong to no matter at all — then, in a third round, ONE window rather than a second modal for recording, a typed length that need not match the clock, the description as the row's second line, an extension where a number runs past its country's length, and a reference number on every row that is on screen before the record exists. The screen moved to /messaging; the sidebar id stays "communications" because a member's stars are stored under it.

- id: communications.messaging.log
  name: Call and text log
  scope: One record per voice call or SMS/MMS message, hand-logged today and carrier-written later, filed onto a matter or waiting in the firm-wide queue.
  status: shipped
  surface: screen
  adrs: ADR-0047
  spec: docs/specs/2026-09-07-call-and-text-log-design.md
  evidence: packages/communications (types, validation, numbering, communication-statements, communication-service) over the per-firm communication table and its communication_number_counter; eleven operations in apps/api-worker/src/http/routes/communications/communications.ts, all present in apps/api-worker/openapi/openapi.json; the firm-wide screen at apps/web/src/routes/(app)/messaging and the matter section at matters/[id]/messaging, both over one listing component and ONE window that records a call, reads one and corrects one; the communication source registered in packages/calendar/src/sources/all.ts and packages/matter-search/src/sources/all.ts; five rows in packages/data-access/src/pii-registry.ts. Exercised by packages/communications/test (53), apps/api-worker/test/communications-routes.test.ts (24) and apps/web/test/communication-log-draft.test.ts (32).
  notes: Only the member producer is built — `producer` is a stored column so a carrier row is never mistaken for a recollection, the insert writes the literal 'member' rather than taking it as a parameter, and a carrier-written row is refused a member's correction. The unrouted queue takes its own capability (communications:reviewUnrouted, seeded to Owner/Admin and Paralegal) because a row with no matter falls through the visible-matter predicate entirely; filing, setting aside and returning to the queue are gated by the same key, since each reads a queued row on its way. A row has one anchor: a matter, or a set-aside reason (spam, firm business, nothing came of it), never both — which is what makes the queue a list somebody can empty. The counterparty number is stored in E.164 where the log form could compose one from the country picked beside the digits, and exactly as typed where it could not: the server still refuses to canonicalize on its own, because that needs a country this subsystem has no way to know. An extension rides in that same string (`+13125550148x4102`), which is what the log's own number check admits and what libphonenumber reads back into two halves. Every row carries a reference number a person can say out loud — the day it happened and that day's own sequence, `2026-09-08-0042` — drawn through the shared counter idiom with the partial unique index over the rendered number as the backstop rather than an allocation table, since the rendered string carries the whole of its scope; `communications.nextNumber` answers what the next draw would render, so a call can be identified while it is still being written down. A call's END is stored beside its LENGTH and the two are not required to agree: a caller left on hold occupies the line without spending it, and both facts are true of one call.

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
  evidence: The logging half landed with communications.messaging.log — a text in either direction is recorded, filed and read. The TWO-WAY half is the part this node names and none of it exists: nothing sends, nothing receives, and there is no port to carry either.

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
  audience: public
  public-name: Calls and voicemail
  public-summary: Take and make firm calls in the app, with voicemail and call records kept on the matter.

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
  evidence: Two channels file onto a matter now — packages/email-filing for mail, packages/communications for calls and texts — and both are redacted by default in the audit log. What is absent is the UNIFIED cross-channel read this node names: no query spans the two, and the place they genuinely converge (a Directory contact's own communications tab) is not built.
