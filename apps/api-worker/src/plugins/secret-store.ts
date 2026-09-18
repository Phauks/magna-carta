import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";
import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";

// The per-firm secret-store seam that backs the CredentialStore for EVERY plugin (buildIntegrationRegistry
// in registry.ts), not any one plugin — hence its home here in plugins/, not in a vendor folder. The
// firm_secret store itself has landed, and so has everything a read of it needs: the store takes a
// protected-field read context (the firm key, the per-firm database, the caller's effective
// permissions, the acting user and a clock), which protected-read-context.ts builds from any
// chokepoint-authenticated request. What remains unwired is the production implementation, because a
// credential read for an OPERATIONAL use is not the same act as an administrator reading a secret:
// the firm_secret value is declared readable with firm:manageSecrets
// (packages/data-access/src/protected-field-registry.ts), while the routes that need a postage
// credential gate on shipping:manage. Until that is settled the production builder REPORTS the
// absence rather than throwing, and tests inject an in-memory SecretStore through CreateAppOptions.
//
// `null` is the whole point of the return type: a throw here surfaces as an unexplained 500 on
// whichever request happened to need a credential, which is a worse answer than the truth and
// arrives after the member has already done the work. Callers turn the null into the framework's
// typed absence (unbuiltCredentialStore → the `credential-store-not-implemented` dispatch outcome).
//
// The context is passed rather than a bare database handle because a SecretStore cannot be built from
// one: getSecret gates and audits the decrypt, so it needs the whole read context, and putSecret
// seals under the firm key, so it needs the key provider. The earlier signature took only the
// database and therefore could not have been implemented at all.
export type SecretStoreForFirm = (context: ProtectedReadContext) => SecretStore | null;

export const firmSecretStoreNotYetAvailable: SecretStoreForFirm = () => null;
