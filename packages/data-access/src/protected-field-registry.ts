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

// A connected integration's credential (the postage account's API key today), sealed under the firm
// key and readable only with integrations:useConnection — an audited decrypt, exactly like every
// other protected read. integration-credential-statements.ts is its reader/writer; the AAD binds each
// value to its integration_credential row id, so a credential cannot be replayed under another ref's
// row. No blind index: a credential is fetched by ref, never matched by value.
//
// Its own declaration rather than a second one on firm_secret.ciphertext, because a protected column
// carries exactly one declaration and that declaration's permission IS the decrypt gate. Sharing the
// column would mean sharing firm:manageSecrets, which would either refuse the member whose route
// already authorized the act or, if granted to them, hand over every other secret the firm holds.
export const integrationCredentialValue = protectedField({
  table: "integration_credential",
  column: "ciphertext",
  purpose: "secrets",
  permission: assertPermission("integrations:useConnection"),
});

// A directory entity's typed identifier value (SSN, EIN, driver's license, account number, DOB, …),
// sealed under the firm pii key and readable only with directory:viewSensitiveIdentifiers (an audited
// decrypt). One physical column holds every identifier type; the row's identifier_type discriminator
// chooses the per-type blind-index policy at write time. This canonical declaration carries the
// decrypt contract (purpose, permission, AAD column) — the read path never consults a blind index, so
// it needs none. The per-type blind-index variants (which exact-match channel a value gets, and the
// frozen normalize transform) are composed in @magna-carta/directory off this declaration; the blind
// index is a property of the write, not of the decrypt. Keeping exactly one declaration per physical
// column is the registry conformance invariant.
export const directoryIdentifierValue = protectedField({
  table: "directory_identifier",
  column: "value_ciphertext",
  purpose: "pii",
  permission: assertPermission("directory:viewSensitiveIdentifiers"),
});

// A matter asset's full account, policy, certificate, or tax number, sealed under the firm pii key.
// It reuses directory:viewSensitiveIdentifiers rather than minting a second decrypt key, because it
// is the same class of secret about the same people and a firm that has decided who may see a
// client's account number has not decided that twice. The asset register's own read/manage pair
// governs the register; this key alone opens a full number, so matterAssets:read never reveals one.
//
// NO BLIND INDEX, deliberately: an exact-match channel over an account number would let a caller who
// already has a number confirm which matter holds it, without a permission check and without an
// audit row, which is exactly the disclosure the sealed column exists to prevent. Nothing in this
// subsystem looks an asset up by identifier value — the searchable identifiers (parcel number,
// vehicle identification number, plate, serial) are plaintext columns because they are public record.
export const matterAssetIdentifierValue = protectedField({
  table: "matter_asset_identifier",
  column: "value_ciphertext",
  purpose: "pii",
  permission: assertPermission("directory:viewSensitiveIdentifiers"),
});

// Every protected-field declaration the chokepoint enforces. Order is not significant.
export const PROTECTED_FIELD_DECLARATIONS: readonly ProtectedFieldDeclaration[] = [
  incidentDescription,
  firmSecretValue,
  integrationCredentialValue,
  directoryIdentifierValue,
  matterAssetIdentifierValue,
];
