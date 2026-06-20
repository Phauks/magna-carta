import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";

// The per-firm secret-store seam that backs the CredentialStore for EVERY plugin (buildIntegrationRegistry
// in registry.ts), not any one plugin — hence its home here in plugins/, not in a vendor folder. The
// firm_secret store itself has landed; the live read is wired by the marketplace slice (it needs a
// firm-key-bearing read context — see the integration platform design). Until then the production
// builder throws and tests inject an in-memory SecretStore through CreateAppOptions.
export type SecretStoreForFirm = (firmDatabase: unknown) => SecretStore;

export const firmSecretStoreNotYetAvailable: SecretStoreForFirm = () => {
  throw new Error("firm_secret credential read is not yet wired (the marketplace slice wires it)");
};
