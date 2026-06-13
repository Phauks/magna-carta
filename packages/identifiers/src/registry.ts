// The single source of truth mapping each entity type to its handle prefix. A handle is
// `<prefix>_<token>` (e.g. mat_V1StGXR8Z5jdHiopq2Cf): the prefix here carries NO trailing underscore —
// the `_` is the separator added at generation time. Adding an entity = one row here + one alias in types.ts.
// Self-describing prefixes make ids debuggable in logs and defend against id-type confusion.
export const ENTITY_PREFIXES = {
  matter: "mat",
  document: "doc",
  directory: "dir",
  invoice: "inv",
  event: "evt",
  portalGrant: "pgr",
  ledgerEntry: "led",
  ledgerAccount: "acct",
  ledgerLine: "lln",
  outbox: "obx",
  idempotencyRecord: "idr",
  user: "usr",
  firm: "firm",
  session: "ses",
  account: "acc",
  verification: "ver",
  twoFactor: "twf",
  role: "rol",
  rolePermission: "rpm",
  memberRole: "mrl",
  grant: "gnt",
  authAudit: "aud",
  error: "err",
  // Matters, Locations & File Manager. `matterType`/`documentType` are the per-firm classification
  // catalogs (distinct from `document`, a stored object); `numberingScheme` is the matter-number
  // template; `file`/`fileVersion` are the versioned object metadata; `uploadSession` tracks an
  // in-flight direct-to-R2 upload; `auditLog` is the per-firm append-only mutation record.
  location: "loc",
  matterType: "mtt",
  documentType: "dty",
  numberingScheme: "nsc",
  folder: "fld",
  file: "fil",
  fileVersion: "fvr",
  uploadSession: "upl",
  auditLog: "alg",
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type];
}
