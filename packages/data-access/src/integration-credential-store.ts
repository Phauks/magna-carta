import {
  CredentialAccessForbiddenError,
  type Credential,
  type CredentialStore,
} from "@magna-carta/integrations/credentials";
import { ProtectedReadForbiddenError, type ProtectedReadContext } from "./protected-fields.ts";
import {
  getIntegrationCredential,
  putIntegrationCredential,
} from "./integration-credential-statements.ts";

// The framework's CredentialStore over the per-firm `integration_credential` table. A Credential is
// JSON-serialized into one row, sealed at rest by the protected-field chokepoint; a read is gated on
// integrations:useConnection and writes its decrypt audit row before any plaintext returns.
//
// One context serves both halves: it carries the firm key the write seals under and the permissions,
// actor and database the read gates and audits with. That is also what keeps the two from addressing
// different firms — there is only one handle to get it wrong with.
//
// This module never logs a credential, and never puts one in an error. A JSON.parse failure here
// would be a corrupted row rather than anything a caller can act on, so it is left to throw as
// itself rather than being wrapped in a message that might carry the value.
export function createIntegrationCredentialStore(context: ProtectedReadContext): CredentialStore {
  return {
    async get(credentialRef: string): Promise<Credential | null> {
      // A refusal is translated, never returned as null: null is how this store says "there is no
      // such credential", and a principal who may not decrypt one would otherwise be told the firm's
      // account is not connected — sending them, and whoever they ask, at the wrong problem.
      let serialized: string | null;
      try {
        serialized = await getIntegrationCredential(context, credentialRef);
      } catch (caught) {
        if (caught instanceof ProtectedReadForbiddenError) {
          throw new CredentialAccessForbiddenError(caught.message);
        }
        throw caught;
      }
      if (serialized === null) return null;
      return JSON.parse(serialized) as Credential;
    },
    async put(credentialRef: string, credential: Credential): Promise<void> {
      await putIntegrationCredential(context, credentialRef, JSON.stringify(credential));
    },
  };
}
