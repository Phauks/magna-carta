import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Credential, CredentialStore } from "@magna-carta/integrations/credentials";
import type { CredentialStoreForFirm } from "../plugins/credential-store.ts";
import { calendarCredentialRefForMember } from "./connect-microsoft-account.ts";

// A member's OWN calendar sign-in, and nothing else in the credential store.
//
// The sealed credential column has one gate, integrations:useConnection, and the firm's default
// roles give it to administrators alone: it is the floor under the firm's own integrations, where
// the credential is the firm's (a postage account) and a route has already checked that
// integration's own permission. A member's calendar sign-in is a different thing held in the same
// column. It is theirs, they put it there by signing in themselves, and the only act taken with it
// is listing or writing their own calendar. Requiring an administrator's permission for that would
// mean a paralegal could connect their calendar and then never use it.
//
// So the worker reads it on the member's behalf, and the two conditions that make that safe are
// held here, in one place, where neither can be forgotten at a call site:
//
//   1. The reference is DERIVED from the session's own user id. Nothing a request carries can name
//      a credential, so there is no reference to another member's sign-in, or to the firm's own
//      credentials, that this store will open.
//   2. Any other reference is refused before the underlying store is asked.
//
// The decrypt is still audited against the member, because the context keeps their user id.
export function memberCalendarCredentialStore(
  context: ProtectedReadContext,
  userId: UserId,
  credentialStoreForFirm: CredentialStoreForFirm,
): CredentialStore {
  const ownReference = calendarCredentialRefForMember(userId);
  const permissions = new Set<Permission>([assertPermission("integrations:useConnection")]);
  for (const permission of context.effectivePermissions) permissions.add(permission);
  const store = credentialStoreForFirm({ ...context, effectivePermissions: permissions });
  const refuseOthers = (credentialRef: string): void => {
    if (credentialRef !== ownReference) {
      throw new Error("A member's calendar credential store opens that member's own sign-in only");
    }
  };
  return {
    get(credentialRef: string): Promise<Credential | null> {
      refuseOthers(credentialRef);
      return store.get(credentialRef);
    },
    put(credentialRef: string, credential: Credential): Promise<void> {
      refuseOthers(credentialRef);
      return store.put(credentialRef, credential);
    },
  };
}
