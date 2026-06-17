// Additional authenticated data: binds each ciphertext to its context (firm, table, field, row,
// and the algorithm/key versions in force) so a sealed value cannot be replayed under a different
// record, field, firm, or format. The serialized bytes are fed into every AES-GCM encrypt and
// decrypt, so a ciphertext moved to a different context fails authentication.
//
// This is a frozen contract: committed golden vectors pin the exact output. Any change to the
// format is a new aad version (a new prefix), never an edit to this one — existing ciphertext must
// keep decrypting.

export interface AadContext {
  readonly firmId: string;
  readonly table: string;
  readonly field: string;
  readonly rowPrimaryKey: string;
  readonly algoVersion: number;
  readonly keyVersion: number;
}

// The literal version prefix. A new format gets a new prefix (mc:aad:v2, …), never an edit to v1.
const AAD_PREFIX = "mc:aad:v1";

// Returns the UTF-8 bytes of the canonical AAD string:
//   mc:aad:v1|<firmId>|<table>|<field>|<rowPrimaryKey>|<algoVersion>|<keyVersion>
// Versions render as decimal. Seven pipe-delimited components, in this fixed order.
export function serializeAad(context: AadContext): Uint8Array {
  const canonical = [
    AAD_PREFIX,
    context.firmId,
    context.table,
    context.field,
    context.rowPrimaryKey,
    String(context.algoVersion),
    String(context.keyVersion),
  ].join("|");

  return new TextEncoder().encode(canonical);
}
