// The registry of columns that hold encrypted-at-rest values. A row here is a contract: the column
// stores only ciphertext, and the data-access `protected()` chokepoint is the ONLY code that may
// write or read it (encrypt on write; permission-checked, audited decrypt on read). The data-access
// conformance fitness consumes this list — every protected column must have exactly one field
// declaration, and the no-plaintext-escape source scan asserts these names appear only in the
// sanctioned data-access modules, the schema, and migrations.
export interface ProtectedColumn {
  readonly table: string;
  readonly column: string;
}

export const PROTECTED_COLUMNS: readonly ProtectedColumn[] = [
  { table: "firm_secret", column: "ciphertext" },
  { table: "integration_credential", column: "ciphertext" },
  { table: "incident", column: "description_ciphertext" },
  { table: "directory_identifier", column: "value_ciphertext" },
  { table: "matter_asset_identifier", column: "value_ciphertext" },
];
