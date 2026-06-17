import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";

// The firm_secret store, backed by the firm's D1. Until slice 1·2 lands, the production builder
// throws (no credential path exists yet); tests inject an in-memory SecretStore through CreateAppOptions.
// When slice 1·2 lands, replace the body with the real getSecret/putSecret over firmDatabase — the
// single line that turns shipping on in production.
export type SecretStoreForFirm = (firmDatabase: unknown) => SecretStore;

export const firmSecretStoreNotYetAvailable: SecretStoreForFirm = () => {
  throw new Error("firm_secret store is not yet wired (slice 1·2)");
};
