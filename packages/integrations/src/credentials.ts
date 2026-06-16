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

export type Credential = OAuthCredential;

export interface CredentialStore {
  get(credentialRef: string): Promise<Credential | null>;
  put(credentialRef: string, credential: Credential): Promise<void>;
}

export interface TokenRefresher {
  refresh(credential: Credential): Promise<Credential>;
}
