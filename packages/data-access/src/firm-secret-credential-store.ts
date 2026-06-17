import type { Credential, CredentialStore } from "@magna-carta/integrations/credentials";

// The slice-1·2 per-firm secret store interface. A Credential is JSON-serialized into one secret
// entry (envelope-encrypted at rest by that store). This module never logs the value.
export interface SecretStore {
  getSecret(ref: string): Promise<string | null>;
  putSecret(ref: string, value: string): Promise<void>;
}

export function createFirmSecretCredentialStore(secrets: SecretStore): CredentialStore {
  return {
    async get(credentialRef: string): Promise<Credential | null> {
      const serialized = await secrets.getSecret(credentialRef);
      if (serialized === null) return null;
      return JSON.parse(serialized) as Credential;
    },
    async put(credentialRef: string, credential: Credential): Promise<void> {
      await secrets.putSecret(credentialRef, JSON.stringify(credential));
    },
  };
}
