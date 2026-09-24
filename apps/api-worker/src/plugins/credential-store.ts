import { createIntegrationCredentialStore } from "@magna-carta/data-access/integration-credential-store";
import type { CredentialStore } from "@magna-carta/integrations/credentials";
import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";

// The per-firm credential store seam that backs EVERY plugin (buildIntegrationRegistry in
// registry.ts), not any one plugin — hence its home here in plugins/, not in a vendor folder. Tests
// inject a fake through CreateAppOptions; production uses the real store below.
export type CredentialStoreForFirm = (context: ProtectedReadContext) => CredentialStore;

// The production store, over the per-firm `integration_credential` table.
//
// This used to be a seam that returned null, and every carrier operation answered 501 because of it.
// What kept it unimplemented was not missing machinery but a permission: the credential lived in
// `firm_secret`, whose decrypt is gated on firm:manageSecrets, while the routes that need a credential
// gate on their own integration's key. Reading a credential to ACT with it and opening the firm's
// vault are different acts, and they could not be told apart while they shared a protected column —
// a column carries exactly one declaration, and that declaration's permission is the gate. The
// credential now has its own column and its own gate (integrations:useConnection), so the store is
// simply the store, and there is no case left in which a deployment has no way to read one.
export const integrationCredentialStoreForFirm: CredentialStoreForFirm = (context) =>
  createIntegrationCredentialStore(context);
