import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";

// The per-firm secret-store seam that backs the CredentialStore for EVERY plugin (buildIntegrationRegistry
// in registry.ts), not any one plugin — hence its home here in plugins/, not in a vendor folder. The
// firm_secret store itself has landed; the live read is wired by the marketplace slice (it needs a
// firm-key-bearing read context — see the integration platform design). Until then the production
// builder REPORTS the absence rather than throwing, and tests inject an in-memory SecretStore
// through CreateAppOptions.
//
// `null` is the whole point of the return type: a throw here surfaces as an unexplained 500 on
// whichever request happened to need a credential, which is a worse answer than the truth and
// arrives after the member has already done the work. Callers turn the null into the framework's
// typed absence (unbuiltCredentialStore → the `credential-store-not-implemented` dispatch outcome).
export type SecretStoreForFirm = (firmDatabase: unknown) => SecretStore | null;

export const firmSecretStoreNotYetAvailable: SecretStoreForFirm = () => null;
