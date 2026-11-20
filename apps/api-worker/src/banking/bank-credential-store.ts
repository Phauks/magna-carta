import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";
import type { Credential, CredentialStore } from "@magna-carta/integrations/credentials";
import type { CredentialStoreForFirm } from "../plugins/credential-store.ts";

// THE FIRM'S BANK SIGN-INS, and nothing else in the credential store.
//
// The sealed credential column is gated on integrations:useConnection, which the default roles give
// to administrators alone. Reading what the bank says is banking:read, which a billing clerk holds;
// the read needs the access token to ask the bank. So a route that holds banking:read (or
// banking:manage) opens the store through this one, which adds the gate for bank-feed references
// only and refuses every other reference before the store is asked. The access token never leaves
// the Worker: the routes use it to call the provider and return only what the bank reported.
//
// The decrypt is still audited against the member, because the context keeps their user id.

const BANK_FEED_PREFIX = "bankFeed:";

/** Where a connection's access token is sealed. Derived from the connection, never from a request. */
export function bankFeedCredentialRef(connectionId: string): string {
  return `${BANK_FEED_PREFIX}${connectionId}`;
}

export function bankFeedCredentialStore(
  context: ProtectedReadContext,
  credentialStoreForFirm: CredentialStoreForFirm,
): CredentialStore {
  const permissions = new Set<Permission>([assertPermission("integrations:useConnection")]);
  for (const permission of context.effectivePermissions) permissions.add(permission);
  const store = credentialStoreForFirm({ ...context, effectivePermissions: permissions });
  const refuseOthers = (credentialRef: string): void => {
    if (!credentialRef.startsWith(BANK_FEED_PREFIX)) {
      throw new Error("The bank feed credential store opens bank sign-ins only");
    }
  };
  return {
    get(credentialRef: string): Promise<Credential | null> {
      refuseOthers(credentialRef);
      return store.get(credentialRef);
    },
    put(credentialRef: string, credential: Credential): Promise<void> {
      refuseOthers(credentialRef);
      // fitness:allow-no-dimensions — not a bucket write: this seals a credential into the per-firm
      // integration_credential table, and nothing reaches object storage.
      return store.put(credentialRef, credential);
    },
  };
}

/** The access token sealed for a connection, or null when there is none. */
export async function readBankAccessToken(
  store: CredentialStore,
  credentialRef: string,
): Promise<string | null> {
  const credential = await store.get(credentialRef);
  return credential?.kind === "apiKey" ? credential.apiKey : null;
}
