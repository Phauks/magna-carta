// The single source of truth mapping each entity type to its handle prefix. A handle is
// `<prefix>_<token>` (e.g. mat_V1StGXR8Z5jdHiopq2Cf): the prefix here carries NO trailing underscore —
// the `_` is the separator added at generation time. Adding an entity = one row here + one alias in types.ts.
// Self-describing prefixes make ids debuggable in logs and defend against id-type confusion (ADR-0062).
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
} as const;

export type EntityType = keyof typeof ENTITY_PREFIXES;
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType];

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type];
}
