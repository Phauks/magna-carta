// Credential storage and token refresh are framework-owned SEAMS. The real backing is slice 1·2's
// per-firm envelope-encrypted `firm_secret` store (getSecret/putSecret); the real refresher is
// serialized by a Durable-Object-per-credential lock (providers silently rotate refresh tokens, so
// concurrent refreshes race). Both are built with the first credentialed adapter — here we fix only
// the interfaces so the registry and adapters compile against a stable contract.
// SECURITY: every field here is a secret. Never log, `JSON.stringify`, or otherwise serialize a
// Credential onto an observable path. The credentialed-adapter slice wraps these in a redacting
// holder; until it lands, callers keep them off all log/telemetry surfaces.
export interface OAuthCredential {
  readonly kind: "oauth";
  readonly accessToken?: string;
  readonly refreshToken: string;
  readonly expiresAt?: string; // ISO-8601 UTC instant
}

export interface ApiKeyCredential {
  readonly kind: "apiKey";
  readonly apiKey: string;
}

export type Credential = OAuthCredential | ApiKeyCredential;

export interface CredentialStore {
  get(credentialRef: string): Promise<Credential | null>;
  put(credentialRef: string, credential: Credential): Promise<void>;
}

// A deployment whose per-firm credential read is a seam nobody has built yet. Stated as a value the
// registry can be handed, rather than a store that throws when constructed: a throw at the seam
// becomes a 500 on a request that could have said what the platform cannot do, and every caller
// would have to catch it to say anything else. Structurally distinct from a CredentialStore (no
// get/put), so the union discriminates without a tag anyone has to remember to set.
// The one throw a CredentialStore is permitted, and the reason `resolve` can still promise never to
// throw: the registry catches exactly this and turns it into the `credential-forbidden` dispatch
// outcome. A store raises it when the principal on whose behalf it was built may not have this
// credential decrypted — a permission answer, not an absence. `get` returning null must keep meaning
// "there is no such credential", or a refusal would read as a disconnected account.
export class CredentialAccessForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialAccessForbiddenError";
  }
}

export interface UnbuiltCredentialStore {
  readonly credentialReadIsBuilt: false;
}

export const unbuiltCredentialStore: UnbuiltCredentialStore = { credentialReadIsBuilt: false };

export function isUnbuiltCredentialStore(
  store: CredentialStore | UnbuiltCredentialStore,
): store is UnbuiltCredentialStore {
  return "credentialReadIsBuilt" in store;
}

export interface TokenRefresher {
  refresh(credential: Credential): Promise<Credential>;
}
