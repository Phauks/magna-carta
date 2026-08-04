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
  // Support-access framework. `platformStaff` identifies a named help-desk operator on the control
  // plane; `supportGrant` is a time-boxed, pull-redeemed access grant issued to that operator.
  platformStaff: "platformStaff",
  supportGrant: "supportGrant",
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
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type];
}
