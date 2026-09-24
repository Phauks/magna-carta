import type { ConnectionStore } from "./connection.ts";
import {
  CredentialAccessForbiddenError,
  isUnbuiltCredentialStore,
  type Credential,
  type CredentialStore,
  type UnbuiltCredentialStore,
} from "./credentials.ts";
import {
  capabilityUnsupported,
  credentialForbidden,
  credentialStoreNotImplemented,
  notConnected,
  ok,
  type Dispatch,
} from "./dispatch.ts";
import { supports, type Adapter, type CapabilityDescriptor } from "./port.ts";

export interface ResolveContext {
  readonly firmId: string;
  readonly userId?: string;
}

export interface Resolved<Port> {
  readonly port: Port;
  readonly descriptor: CapabilityDescriptor;
}

export interface RegistryStores {
  readonly connectionStore?: ConnectionStore;
  // Either a real credential read, or the value that says this deployment has none built. Absent
  // (undefined) still means "this registry was assembled without one", which resolves as
  // not-connected the way it always has.
  readonly credentialStore?: CredentialStore | UnbuiltCredentialStore;
}

export interface IntegrationRegistry {
  register<Port>(adapter: Adapter<Port>): void;
  resolve<Port>(category: string, context: ResolveContext): Promise<Dispatch<Resolved<Port>>>;
}

// One registered first-party adapter per category at launch. Resolution: credential-less adapters
// instantiate directly; credentialed ones require a healthy connection + a loaded credential,
// returning a typed `not-connected` otherwise — or `credential-store-not-implemented` where the
// deployment has no per-firm credential read at all. Never a throw.
export function createIntegrationRegistry(stores: RegistryStores = {}): IntegrationRegistry {
  const adapters = new Map<string, Adapter<unknown>>();

  return {
    register<Port>(adapter: Adapter<Port>): void {
      adapters.set(adapter.descriptor.category, adapter as Adapter<unknown>);
    },

    async resolve<Port>(
      category: string,
      context: ResolveContext,
    ): Promise<Dispatch<Resolved<Port>>> {
      // Keyed by string category; the caller requests the Port matching the category it asks for —
      // the registry can't statically tie a runtime string to a port type, so this cast is that
      // contract made explicit (the standard typed-registry tradeoff).
      const adapter = adapters.get(category) as Adapter<Port> | undefined;
      if (adapter === undefined) return notConnected();

      const requirement = adapter.descriptor.credential;
      if (requirement.kind === "none") {
        return ok({ port: adapter.create({}), descriptor: adapter.descriptor });
      }

      const { connectionStore, credentialStore } = stores;
      // Answered BEFORE the connection lookup, and separately from it: with no credential read
      // there is no connection that could ever resolve, so reporting "not connected" would be a
      // true-sounding sentence pointing at the wrong remedy.
      if (credentialStore !== undefined && isUnbuiltCredentialStore(credentialStore)) {
        return credentialStoreNotImplemented();
      }
      if (connectionStore === undefined || credentialStore === undefined) return notConnected();

      // A user-scoped port MUST carry a user — never silently fall back to a firm-wide lookup, which
      // would let one user's connection resolve for another within the firm. Firm-scoped ports
      // ignore userId by design.
      let userId: string | undefined;
      if (requirement.scope === "user") {
        if (context.userId === undefined) return notConnected();
        userId = context.userId;
      }
      const connection = await connectionStore.getConnection({
        firmId: context.firmId,
        userId,
        category,
      });
      if (
        connection === null ||
        connection.status === "disabled" ||
        connection.status === "needs_reauth"
      ) {
        return notConnected();
      }

      // The one throw a store is permitted, turned into its outcome here so `resolve` keeps its
      // promise never to throw. A refusal is NOT `not-connected`: the account is connected and the
      // credential is there, and this principal simply may not have it decrypted.
      let credential: Credential | null;
      try {
        credential = await credentialStore.get(connection.credentialRef);
      } catch (caught) {
        if (caught instanceof CredentialAccessForbiddenError) return credentialForbidden();
        throw caught;
      }
      if (credential === null) return notConnected();

      return ok({
        port: adapter.create({ credential }),
        descriptor: connection.capabilitySnapshot,
      });
    },
  };
}

// The single place the `capability-unsupported` outcome is minted: callers gate an operation by
// name against the resolved descriptor before invoking it.
export function requireCapability<Port>(
  resolved: Resolved<Port>,
  operation: string,
): Dispatch<Resolved<Port>> {
  return supports(resolved.descriptor, operation) ? ok(resolved) : capabilityUnsupported();
}
