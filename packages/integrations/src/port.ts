import type { Credential } from "./credentials.ts";

// A port is a TypeScript interface named in OUR domain vocabulary (defined by the consuming domain
// package, e.g. ParcelLookupPort in @magna-carta/government-links), not a vendor's API. An adapter implements
// one port for one external platform. The descriptor is the adapter's published manifest of what it
// can do, so callers degrade gracefully instead of calling a method that throws.

export type AdapterScope = "firm" | "user";

// Credential-less adapters (e.g. a county deep-link resolver) declare `none`; credentialed adapters
// declare the scope at which a connection is keyed — `user` (each attorney authorizes their own
// account) or `firm` (one connection for the firm). The PORT picks; the framework supports both.
export type CredentialRequirement =
  | { readonly kind: "none" }
  | { readonly kind: "oauth"; readonly scope: AdapterScope }
  | { readonly kind: "apiKey"; readonly scope: AdapterScope };

// An object rather than a bare boolean so it can carry future per-operation metadata — supported
// fields, required parameters — the way unified-API capability manifests do.
export interface OperationSupport {
  readonly supported: boolean;
}

export interface CapabilityDescriptor {
  readonly adapterId: string;
  readonly category: string;
  readonly credential: CredentialRequirement;
  readonly operations: Readonly<Record<string, OperationSupport>>;
  // Gate read by passthrough callers (the vendor-native proxy escape hatch); declared now, the
  // proxy itself lands with the first credentialed adapter.
  readonly passthroughAvailable: boolean;
}

export interface AdapterContext {
  readonly credential?: Credential;
}

export interface Adapter<Port> {
  readonly descriptor: CapabilityDescriptor;
  create(context: AdapterContext): Port;
}

export function supports(descriptor: CapabilityDescriptor, operation: string): boolean {
  return descriptor.operations[operation]?.supported === true;
}
