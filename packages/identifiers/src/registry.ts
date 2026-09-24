// The single source of truth mapping each entity type to its handle prefix. A handle is
// `<prefix>_<token>` (e.g. matter_V1StGXR8Z5jdHiopq2Cf): the prefix carries NO trailing underscore —
// the `_` is the separator added at generation time, and the single `_` is what splits the prefix
// from the token (the token alphabet `[A-Za-z0-9_-]` may itself contain `_`, so word boundaries in
// the prefix come from camelCase, never an underscore). The prefix is the entity type spelled out in
// full — identical to the key — so names are never abbreviated and the prefix can never drift from
// the key. Self-describing prefixes make ids debuggable in logs and defend against id-type confusion.
// Adding an entity = one row here (prefix = the key) + one alias in types.ts.
export const ENTITY_PREFIXES = {
  matter: "matter",
  document: "document",
  directory: "directory",
  invoice: "invoice",
  event: "event",
  portalGrant: "portalGrant",
  ledgerEntry: "ledgerEntry",
  ledgerAccount: "ledgerAccount",
  ledgerLine: "ledgerLine",
  outbox: "outbox",
  idempotencyRecord: "idempotencyRecord",
  user: "user",
  firm: "firm",
  session: "session",
  account: "account",
  verification: "verification",
  twoFactor: "twoFactor",
  role: "role",
  rolePermission: "rolePermission",
  memberRole: "memberRole",
  grant: "grant",
  authAudit: "authAudit",
  error: "error",
  // Telemetry-minted handles (correlation rides every request/event/problem; incident is the
  // user-reported row) — prefixes spelled out in full, the same no-shorthand rule as every entry.
  correlation: "correlation",
  incident: "incident",
  integrationConnection: "integrationConnection",
  integrationCredential: "integrationCredential",
  // AI-text detection metering — tracks usage of the AI-text detection tool across the firm.
  aiDetectionUsage: "aiDetectionUsage",
  repairProvenance: "repairProvenance",
  // Matters, Locations & File Manager. `matterType`/`documentType` are the per-firm classification
  // catalogs (distinct from `document`, a stored object); `numberingScheme` is the matter-number
  // template; `file`/`fileVersion` are the versioned object metadata; `uploadSession` tracks an
  // in-flight direct-to-R2 upload; `auditLog` is the per-firm append-only mutation record.
  location: "location",
  locationAddress: "locationAddress",
  memberLocation: "memberLocation",
  matterType: "matterType",
  documentType: "documentType",
  numberingScheme: "numberingScheme",
  folder: "folder",
  file: "file",
  fileVersion: "fileVersion",
  uploadSession: "uploadSession",
  auditLog: "auditLog",
  // A per-firm wrapped encryption key — the firm-secret row holding a data key sealed under the
  // root key-encryption key. The full-name prefix keeps the handle self-describing in logs.
  firmSecret: "firmSecret",
  // Directory entity graph — persons, organizations, their names, identifiers, edges, and contact
  // details. Each entity type has its own prefixed handle so id-type confusion is caught at the
  // type level. Full-word prefixes (no abbreviations) per golden rule 12.
  directoryPerson: "directoryPerson",
  directoryOrganization: "directoryOrganization",
  directoryName: "directoryName",
  directoryIdentifier: "directoryIdentifier",
  directoryEdge: "directoryEdge",
  conflictsCheck: "conflictsCheck",
  conflictsHit: "conflictsHit",
  conflictsDisposition: "conflictsDisposition",
  // One re-check the platform owes a matter because the corpus under it moved.
  conflictsRecheckRequest: "conflictsRecheckRequest",
  directoryCategory: "directoryCategory",
  directoryEmail: "directoryEmail",
  directoryPhone: "directoryPhone",
  directoryAddress: "directoryAddress",
  directoryPartyRole: "directoryPartyRole",
  matterParty: "matterParty",
  entityMerge: "entityMerge",
  // Shipping & postage. `shipment` is a mailing; `shipmentLabel` is a bought label's metadata (PDF in
  // R2); `trackingEvent` is one carrier scan appended as tracking is pulled.
  shipment: "shipment",
  shipmentLabel: "shipmentLabel",
  trackingEvent: "trackingEvent",
  // Custom fields — per-firm field definitions, picklist option values, and the per-entity field
  // values that record what was entered. Three distinct entity types keep id-type confusion impossible.
  customField: "customField",
  picklistOption: "picklistOption",
  customFieldValue: "customFieldValue",
  // In-app editing — a document checkout: an offline-working-copy claim or an opt-in exclusive lock on
  // a file, tracked through acquisition, staleness, release, and reconciliation.
  documentCheckout: "documentCheckout",
  // Time tracking, WIP & the rate engine. `timeEntry` is one captured unit of time (the WIP store);
  // `rateCard`/`rate` are the effective-dated rate versions; `utbmsCode` is one ABA UTBMS catalog
  // entry; `nonBillableCategory` classifies non-billable internal time; `narrativeTemplate` is a
  // reusable per-task-code description. Full-word prefixes (no abbreviations) per golden rule 12.
  timeEntry: "timeEntry",
  rateCard: "rateCard",
  rate: "rate",
  utbmsCode: "utbmsCode",
  nonBillableCategory: "nonBillableCategory",
  narrativeTemplate: "narrativeTemplate",
  // Server-side conversion — a transient job identifier minted at presign time and used to key the
  // coordinator Durable Object. Not persisted in D1; the DO itself is the state store for the job.
  conversionJob: "conversionJob",
  // Costs & expenses WIP — one matter disbursement captured as a cost entry (the parallel to
  // timeEntry for non-time billables and cost-recovery amounts).
  costEntry: "costEntry",
  // Fees WIP — one flat charge for professional services, typed by hand. The third work-in-progress
  // record beside timeEntry and costEntry, riding the same chain and claimed onto a draft invoice
  // the same way. It is never computed from time entries: the amount is what somebody decided to
  // charge, which is exactly why it needs a record of its own rather than a projection.
  feeEntry: "feeEntry",
  // Support-access framework. `platformStaff` identifies a named help-desk operator on the control
  // plane; `supportGrant` is a time-boxed, pull-redeemed access grant issued to that operator.
  platformStaff: "platformStaff",
  supportGrant: "supportGrant",
  // Joining the platform. `registration` is a self-serve sign-up in flight — the control-plane row a
  // stranger's request costs before anything they asked for exists; `invitation` is a firm's own
  // invitation to a member or a portal client, redeemed against a code plus two facts about the
  // person. Both handles are internal: neither is ever the secret a redeemer types.
  registration: "registration",
  invitation: "invitation",
  // Password recovery — a transient job identifier minted at recover-request time and used to key
  // the RecoveryJobCoordinator Durable Object (mirrors conversionJob: not persisted in D1, the DO
  // itself is the state store for the job).
  recoveryJob: "recoveryJob",
  serviceEvent: "serviceEvent",
  serviceComponent: "serviceComponent",
  // Email filing & capture. `emailMessage` is one unique captured message (the unit of truth);
  // `emailThread` groups a conversation DAG; `emailMatterLink` is the multi-matter junction row;
  // `emailParticipant` is one from/to/cc/bcc address frozen as-at receipt; `emailAttachment` ties a
  // File Manager file back to its message. `emailCaptureAddress` is a per-firm forward/CC token
  // address that resolves to a firm (and, for a per-matter token, a candidate matter).
  emailMessage: "emailMessage",
  emailThread: "emailThread",
  emailMatterLink: "emailMatterLink",
  emailParticipant: "emailParticipant",
  emailAttachment: "emailAttachment",
  emailCaptureAddress: "emailCaptureAddress",
  // Auto-file rules. `emailAutoFileRule` is one typed, matter-bound, revocable delegation — a person
  // who could have filed a class of messages by hand telling the platform to do it for them;
  // `emailAutoFileDecision` is one row of the evaluation ledger, recording what a rule did or what
  // stopped it, in identifiers and enums only.
  emailAutoFileRule: "emailAutoFileRule",
  emailAutoFileDecision: "emailAutoFileDecision",
  // Calls and texts. A `communication` is one voice call or one SMS/MMS message the firm made or
  // took — the log entry, whether a member typed it in after the fact or a carrier webhook wrote it.
  // Its matter is nullable because an inbound text from an unrecognised number belongs to nobody
  // until somebody files it, and because the anchor it eventually gets need not be a NUMBERED matter:
  // an intake and a consultation are anchors a first contact usually lands on.
  communication: "communication",
  // Discovery search index. An `indexSplit` is one immutable Tantivy split — a self-contained bundle of
  // index files stored as one object in the firm's R2 — recorded in the per-firm catalog that a query
  // enumerates to know which splits are live for a matter.
  indexSplit: "indexSplit",
  // Document automation. `documentTemplate` is the firm-level catalogue row for one assembly template;
  // `documentTemplateVersion` is one immutable registered upload of that template's bytes (the version a
  // finished document records it was produced from); `documentAssembly` is the provenance row for one
  // assembly job — which template version, which matter, what outcome. A
  // `documentTemplateFieldMapping` is one confirmed Word-merge-field-name to merge-key mapping in the
  // firm's own mapping library, which is what makes a second template import reuse the first one's
  // answers instead of asking again.
  documentTemplate: "documentTemplate",
  documentTemplateVersion: "documentTemplateVersion",
  documentTemplateFieldMapping: "documentTemplateFieldMapping",
  documentAssembly: "documentAssembly",
  // Custodian — the register of physical client originals the firm holds. A `custodyPacket` is the
  // unit of custody (the envelope or deed box that physically moves); a `custodyItem` is one thing
  // described inside it; `custodyLocation` is a node of the physical container tree; `custodyOwner`
  // is the link to the Directory entity the property belongs to; `custodyMovement` is one row of the
  // append-only custody ledger; `custodyHold` blocks release and destruction; `custodyScan` links a
  // File Manager file to a packet or item; `custodyItemType` is the per-firm classification catalog;
  // `custodyDestructionRequest` is the two-person destruction workflow record; a `custodyStocktake`
  // is one physical count of the register or a part of it, and a `custodyStocktakeSighting` is one
  // person's evidentiary observation made during that count.
  custodyLocation: "custodyLocation",
  custodyPacket: "custodyPacket",
  custodyItem: "custodyItem",
  custodyItemType: "custodyItemType",
  custodyOwner: "custodyOwner",
  custodyMovement: "custodyMovement",
  custodyHold: "custodyHold",
  custodyScan: "custodyScan",
  custodyDestructionRequest: "custodyDestructionRequest",
  custodyStocktake: "custodyStocktake",
  custodyStocktakeSighting: "custodyStocktakeSighting",
  // Trust accounting. A `trustAccount` is one real bank account holding client money; a
  // `trustLedgerNode` names which ledger account under it belongs to which client or matter (the
  // sub-ledger tree); a `trustHold` restricts part of a node's balance without moving money; a
  // `trustTransfer` is the shared link between the two entries a trust-to-operating movement posts;
  // a `trustMovement` is the client-ledger record beside one trust entry — who the money came from
  // or went to, why, by what method, and who authorized it. A `trustDisbursementRequest` is a
  // proposed payment out of a client ledger that has not moved any money yet, and a
  // `trustDisbursementDecision` is the single append-only row that settles one — the approval that
  // posts the movement, or the rejection or withdrawal that does not.
  //
  // Reconciliation adds the bank's side of the same money: a `trustBankStatement` is one period as
  // the institution reported it, a `trustBankStatementLine` is one item on that statement, a
  // `trustReconciliation` is a firm's attempt to tie a statement to its own records, and a
  // `trustReconciliationMatch` is a person's assertion that one statement line and one recorded
  // movement are the same event.
  trustAccount: "trustAccount",
  trustLedgerNode: "trustLedgerNode",
  trustHold: "trustHold",
  trustTransfer: "trustTransfer",
  trustMovement: "trustMovement",
  trustDisbursementRequest: "trustDisbursementRequest",
  trustDisbursementDecision: "trustDisbursementDecision",
  // A `trustAuthorizationPolicy` is one immutable version of the firm's disbursement-authorization
  // posture — off, threshold, or always, plus whether the deciding member must hold the authority
  // capability. The current policy is the highest version; a pending request keeps the version it
  // was created under.
  trustAuthorizationPolicy: "trustAuthorizationPolicy",
  trustBankStatement: "trustBankStatement",
  trustBankStatementLine: "trustBankStatementLine",
  trustReconciliation: "trustReconciliation",
  trustReconciliationMatch: "trustReconciliationMatch",
  // A `trustFirmFundsMovement` is the record beside an entry touching the firm's OWN money in a
  // trust account — the permitted cushion that bears the bank's service charges. It is a separate
  // kind from `trustMovement` because it can never name a client or a matter, which is what keeps
  // the carve-out from becoming a second way to move client money.
  trustFirmFundsMovement: "trustFirmFundsMovement",
  // Unclaimed client funds. A `trustUnclaimedFundsReview` is a firm's open diligence file over one
  // dormant matter ledger; a `trustUnclaimedFundsContactAttempt` is one locate attempt recorded when
  // it was made; a `trustUnclaimedFundsReviewClosure` is the single row that ends a review and, when
  // the owner was found, names the disbursement that already paid them.
  trustUnclaimedFundsReview: "trustUnclaimedFundsReview",
  trustUnclaimedFundsContactAttempt: "trustUnclaimedFundsContactAttempt",
  trustUnclaimedFundsReviewClosure: "trustUnclaimedFundsReviewClosure",
  // Billing and invoicing. An `invoice` is the header (registered above, alongside the earliest
  // entities); an `invoiceLine` is what the client is told, in presentation order; an
  // `invoiceWipClaim` records which work-in-progress row an invoice has taken, and IS the
  // concurrency control that stops two drafts billing one hour. An `invoiceApplication` is one unit
  // of value reaching an invoice — a payment, a transfer of earned fees out of trust, a credit note,
  // a client credit, a write-off, or the reversal of one of those. A `creditNote` and its
  // `creditNoteLine` correct a finalized invoice without editing it; a `clientCredit` is value owed
  // back to a client that has not been discharged yet; an `invoiceDelivery` is one attempt at
  // getting a bill to the client, recorded per attempt because a re-send is not a change to the
  // financial record. A `billingArrangement` is the effective-dated record of how a matter is
  // billed, and a `taxRate` is one rate in the firm's own configured catalog.
  invoiceLine: "invoiceLine",
  invoiceWipClaim: "invoiceWipClaim",
  invoiceApplication: "invoiceApplication",
  // An `invoiceTrustApplicationLine` is one invoice-and-amount a pending earned-fee application
  // request proposes to settle — the particulars an approving member is approving, stored beside
  // the shared trust_disbursement_request row the queue and its decision discipline live on.
  invoiceTrustApplicationLine: "invoiceTrustApplicationLine",
  creditNote: "creditNote",
  creditNoteLine: "creditNoteLine",
  clientCredit: "clientCredit",
  invoiceDelivery: "invoiceDelivery",
  billingArrangement: "billingArrangement",
  taxRate: "taxRate",
  // A `matterRecovery` is one recorded recovery on a matter — a settlement, judgment, or award — the
  // amount a contingency fee is computed FROM at invoice time; the fee itself is always derived,
  // never stored on the recovery. A `retainerReplenishmentRequest` records that a matter's trust
  // balance fell below the retainer arrangement's floor and by how much, so the ask is a record the
  // firm can act on rather than a number somebody once noticed.
  matterRecovery: "matterRecovery",
  retainerReplenishmentRequest: "retainerReplenishmentRequest",
  // The case calendar. A `matterEvent` is one thing that happened or will happen in the case that no
  // other subsystem records — a hearing, a filing, service, an order, a deposition; a
  // `matterEventType` is the per-firm classification catalog behind it; a `matterEventParticipant`
  // is one person who was or will be there, whether a firm member, a Directory entity, or somebody
  // external to both. A `matterDeadline` is a date the firm must do something by, which is a
  // different record from an event because it can be satisfied and it comes from somewhere.
  matterEvent: "matterEvent",
  matterEventType: "matterEventType",
  matterEventParticipant: "matterEventParticipant",
  matterDeadline: "matterDeadline",
  // The matter note: what the firm wrote down about a case that no other record holds — its words,
  // who wrote them, when they were written, and optionally when the thing they describe happened. A
  // `matterNoteDocument` links one of the matter's files to one note, which is an ASSOCIATION with
  // its own identity: detaching it leaves the document exactly where it lives.
  matterNote: "matterNote",
  matterNoteDocument: "matterNoteDocument",
  // The task: one piece of work with somebody's name on it and a state that says whether it is
  // still owed. A `matterTask` is named for the matter it usually sits on, and its matter is
  // nullable because plenty of a firm's work belongs to no client file — renewing the malpractice
  // policy, interviewing a candidate. A `matterTaskDocument` links one of the matter's files to one
  // task, on the note attachment's model: an association with its own identity, whose removal
  // leaves the document where it lives.
  matterTask: "matterTask",
  matterTaskDocument: "matterTaskDocument",
  // A task's identity in a system that is not this one. The platform ships no such system and never
  // will — this is the seam an ADDON writes through, so the `system` it names is open text rather
  // than an enum and adding a second one is not a migration. A `matterTaskDeletion` is the tombstone
  // a hard delete leaves behind: a row that is gone cannot be enumerated afterwards, and a mirror
  // that never learns of the deletion keeps the work alive somewhere the firm stopped looking.
  matterTaskExternalLink: "matterTaskExternalLink",
  matterTaskDeletion: "matterTaskDeletion",
  // The matter plan: a firm's own statement of the work a kind of matter takes. A
  // `matterPlanTemplate` is the plan; a `matterPlanTaskTemplate` is one task it PROPOSES, carrying a
  // due-date anchor rather than a date and a role rather than a member, because both alternatives are
  // wrong the moment the template is used twice.
  matterPlanTemplate: "matterPlanTemplate",
  matterPlanTaskTemplate: "matterPlanTaskTemplate",
  // The intake procedure: what a kind of matter must clear before it opens. An `intakeProcedure` is
  // the firm's list for one matter type (or every type); an `intakeProcedureStep` is one thing on it,
  // answered by the subsystem its kind names or by a member; a `matterIntakeStepRecord` is a
  // member's answer to one step on one matter, append-and-flip.
  intakeProcedure: "intakeProcedure",
  intakeProcedureStep: "intakeProcedureStep",
  matterIntakeStepRecord: "matterIntakeStepRecord",
  // The firm's own calendar scope. A `firmEvent` is something the firm schedules for itself — a
  // meeting, an office closure, training, a firm holiday — which belongs to no matter and so gets
  // its own table rather than a null where a case should be; a `firmEventParticipant` is one person
  // on it, in the same three shapes a matter event's participants take. A `firmResource` is a
  // bookable thing the firm owns (a conference room, a pool car, a projector); a
  // `firmResourceBooking` occupies one resource for one event's sake, with its own window because
  // the room is booked from half past eight for a nine o'clock deposition. A `calendarEventLink` is
  // a typed relation between two events — `related`, or the `continuance_of` chain that shows what
  // a continued hearing was continued from.
  firmEvent: "firmEvent",
  firmEventParticipant: "firmEventParticipant",
  firmResource: "firmResource",
  firmResourceBooking: "firmResourceBooking",
  calendarEventLink: "calendarEventLink",
  // Meetings — the room a calendar event is held in when it is held in this product rather than in
  // somebody else's. A `meeting` belongs to exactly one event, matter or firm, and carries no title,
  // time or participant list of its own: those are the event's, so a meeting handle names the room
  // and nothing more. A `meetingAttendance` is one person's presence in it, opened when they join
  // and closed when they leave — a row per stay rather than a flag per person, because somebody who
  // drops off and dials back in was in the room twice and the record should say so.
  meeting: "meeting",
  meetingAttendance: "meetingAttendance",
  // The matter asset register — what a client or an estate owns, recorded against one matter. A
  // `matterAsset` is one matter's assertion about one thing owned; a `matterAssetType` is the
  // per-firm catalog under the platform class the asset carries. A `matterAssetValuation` is one
  // dated assertion of what the thing was worth, appended and never edited; a `matterAssetInterest`
  // is one Directory entity's stake in it; a `matterAssetEncumbrance` is a charge secured against
  // it; a `matterAssetDocument` links an already-ingested file to it; and a `matterAssetIdentifier`
  // holds a credential-adjacent number (an account or policy number) as ciphertext plus the last
  // four characters everything else reads.
  matterAsset: "matterAsset",
  matterAssetType: "matterAssetType",
  matterAssetInterest: "matterAssetInterest",
  matterAssetValuation: "matterAssetValuation",
  matterAssetEncumbrance: "matterAssetEncumbrance",
  matterAssetDocument: "matterAssetDocument",
  matterAssetIdentifier: "matterAssetIdentifier",
  // The matter's own identity records beyond the shell. A `matterAssignment` is one firm member
  // staffed onto a matter in a named working role (the responsible attorney stays on the matter row
  // itself); a `matterCourtCase` is the matter's court-and-case identity — the court, the case
  // number, and the designation words a caption prints; a `matterEstate` is the estate a probate
  // matter administers — the decedent, the date of death, and the styles a court has fixed.
  matterAssignment: "matterAssignment",
  matterCourtCase: "matterCourtCase",
  matterEstate: "matterEstate",
  // Magnus — the conversational assistant a firm member talks to. A `magnusConversation` is one
  // thread a member started, kept as a firm record; a `magnusTurn` is one message inside it, from
  // either the member or Magnus, ordered by an explicit sequence rather than by its timestamp. The
  // member acknowledgement of the disclosure is keyed by the member's own `user_id` and needs no
  // handle of its own.
  magnusConversation: "magnusConversation",
  magnusTurn: "magnusTurn",
  // Discovery — the corpus of documents under review on a matter. A `reviewSet` is one named corpus
  // with its own index, lifecycle, and access story; a `recordCustodian` is whose electronic records
  // the material was (two words, always — the physical safekeeping register keeps `custody*`, and
  // tooling/lint-custodian-vocabulary.mjs enforces both directions). A `discoveryLoad` is one
  // recorded act of putting material into a review set — the unit of provenance and of resumability.
  // A `reviewDocument` is the reviewable unit: a pointer to a file version or an email message plus
  // the discovery facts about it, never a copy of content. A `reviewDocumentException` is one named
  // reason a document did not process, and a `reviewDocumentOccurrence` is one further copy of a
  // deduplicated document, kept rather than deleted so the attribution survives.
  reviewSet: "reviewSet",
  recordCustodian: "recordCustodian",
  discoveryLoad: "discoveryLoad",
  reviewDocument: "reviewDocument",
  reviewDocumentException: "reviewDocumentException",
  reviewDocumentOccurrence: "reviewDocumentOccurrence",
  // Review coding, and who may reach a corpus at all. A `reviewSetAccess` is one person's membership
  // of one review set's access list — reaching a review set never follows from reaching its matter,
  // because material produced under a protective order may be attorney's-eyes-only. A
  // `reviewTagGroup` is one ordered question on the coding panel (single- or multi-choice) and a
  // `reviewTag` is one answer to it; a `reviewDocumentTag` is one application of one tag to one
  // document, never deleted — removal is a state with an actor and an instant. A `reviewTagEvent` is
  // one human act of coding, however many documents it touched, and is what an undo reverses.
  reviewSetAccess: "reviewSetAccess",
  reviewTagGroup: "reviewTagGroup",
  reviewTag: "reviewTag",
  reviewDocumentTag: "reviewDocumentTag",
  reviewTagEvent: "reviewTagEvent",
  // Notifications — how a thing the platform noticed reaches a person. A `notificationEvent` is the
  // fact ONCE, however many people hear about it: a kind, the record it points at, the matter that
  // anchors its visibility, and a closed set of non-privileged facts. A `notificationRecipient` is
  // one person's copy of it and the only home of whether they have dealt with it, which is why read
  // state lives here and not on a channel — "has this person seen it" must not depend on which
  // channel you ask. A `notificationDelivery` is one attempt to push that copy OUT of the platform
  // (email today; push, SMS and desktop are seeded values), with attempts, a failure state, and a
  // closed suppression reason; the in-app feed deliberately gets none, because the recipient row's
  // existence IS the delivery. A `notificationDigest` is one composed outbound summary and the
  // watermark that says where the next one starts.
  notificationEvent: "notificationEvent",
  notificationRecipient: "notificationRecipient",
  notificationDelivery: "notificationDelivery",
  notificationDigest: "notificationDigest",
  // The download register — one member's shelf of what the platform produced for them, held for a
  // short retention window. A `downloadItem` is one row on that shelf, and it is deliberately the
  // only handle: the artifact it points at (a bundle keyed by its content hash, a conversion result
  // keyed by its job id) keeps the addressing its own producer gave it, and a snapshot's stored
  // document is keyed by this id. Not a notification and never one — a generated file is platform
  // mechanics rather than a fact about the firm's work.
  downloadItem: "downloadItem",
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type];
}
