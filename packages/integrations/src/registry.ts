import type { ConnectionStore } from "./connection.ts";
import type { CredentialStore } from "./credentials.ts";
import { capabilityUnsupported, notConnected, ok, type Dispatch } from "./dispatch.ts";
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
  readonly credentialStore?: CredentialStore;
}

export interface IntegrationRegistry {
  register<Port>(adapter: Adapter<Port>): void;
  resolve<Port>(category: string, context: ResolveContext): Promise<Dispatch<Resolved<Port>>>;
}

// One registered first-party adapter per category at launch. Resolution: credential-less adapters
// instantiate directly; credentialed ones require a healthy connection + a loaded credential,
// returning a typed `not-connected` otherwise — never a throw.
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
      const adapter = adapters.get(category) as Adapter<Port> | undefined;
      if (adapter === undefined) return notConnected();

      const requirement = adapter.descriptor.credential;
      if (requirement.kind === "none") {
        return ok({ port: adapter.create({}), descriptor: adapter.descriptor });
      }

      const { connectionStore, credentialStore } = stores;
      if (connectionStore === undefined || credentialStore === undefined) return notConnected();

      const userId = requirement.scope === "user" ? context.userId : undefined;
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

      const credential = await credentialStore.get(connection.credentialRef);
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
