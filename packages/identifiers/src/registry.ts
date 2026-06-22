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
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type];
}
