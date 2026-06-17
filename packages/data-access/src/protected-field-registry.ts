import { assertPermission } from "@magna-carta/access-control/registry";
import { protectedField, type ProtectedFieldDeclaration } from "./protected-fields.ts";

// The platform registry of protected-field declarations: one declaration per encrypted column, each
// binding the column to its purpose key and the permission required to decrypt it. The conformance
// fitness test cross-checks this list against @magna-carta/database's PROTECTED_COLUMNS (exactly one
// declaration per protected column) and the per-firm schema (every (table, column) exists), and
// against the access-control registry (every permission is a registered key). New protected columns
// are declared here; a column with no declaration cannot be written or read through the chokepoint.

// An incident's user-authored description, sealed under the firm pii key and readable only with
// incidents:viewDescription (an audited decrypt). No blind index: a free-text description is never
// matched by exact equality.
export const incidentDescription = protectedField({
  table: "incident",
  column: "description_ciphertext",
  purpose: "pii",
  permission: assertPermission("incidents:viewDescription"),
});

// The per-firm named-secret store's value column, sealed under the firm secrets key and readable
// only with firm:manageSecrets (an audited decrypt). The secrets store (secret-statements.ts) is its
// reader/writer; the AAD binds each value to its firm_secret row id, so a secret cannot be replayed
// under another name's row. No blind index: secrets are fetched by name, never matched by value.
export const firmSecretValue = protectedField({
  table: "firm_secret",
  column: "ciphertext",
  purpose: "secrets",
  permission: assertPermission("firm:manageSecrets"),
});

// Every protected-field declaration the chokepoint enforces. Order is not significant.
export const PROTECTED_FIELD_DECLARATIONS: readonly ProtectedFieldDeclaration[] = [
  incidentDescription,
  firmSecretValue,
];
