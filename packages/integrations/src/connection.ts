import type { AdapterScope, CapabilityDescriptor } from "./port.ts";
import type { ProblemCategory } from "./problem.ts";

// A connection's health, rendered by the (future) connection-management UI and read by the registry
// to decide whether an adapter is usable.
export type ConnectionHealth = "connected" | "degraded" | "needs_reauth" | "disabled";

export type HealthSignal =
  | { readonly kind: "success" }
  | { readonly kind: "error"; readonly category: ProblemCategory }
  | { readonly kind: "circuit-open" }
  | { readonly kind: "disable" }
  | { readonly kind: "enable" };

// Pure transition. `disabled` is admin-controlled (only an explicit enable leaves it). An auth error
// outranks transient noise: a needs_reauth connection stays needs_reauth until a success clears it.
export function nextHealth(current: ConnectionHealth, signal: HealthSignal): ConnectionHealth {
  if (signal.kind === "disable") return "disabled";
  if (current === "disabled") return signal.kind === "enable" ? "connected" : "disabled";
  if (signal.kind === "enable" || signal.kind === "success") return "connected";
  if (signal.kind === "error" && signal.category === "auth") return "needs_reauth";
  if (current === "needs_reauth") return "needs_reauth";
  return "degraded";
}

// One authorized account (the Nylas Connector/Grant "grant"), recorded per-firm. Refs are plain
// strings here; the worker/data-access layer brands them (Identifier<"integrationConnection">) and
// owns persistence. `capabilitySnapshot` is the descriptor captured at connect time.
export interface IntegrationConnection {
  readonly id: string;
  readonly category: string;
  readonly adapterId: string;
  readonly scope: AdapterScope;
  readonly principalRef: string;
  readonly credentialRef: string;
  readonly status: ConnectionHealth;
  readonly capabilitySnapshot: CapabilityDescriptor;
}

export interface ConnectionLookup {
  readonly firmId: string;
  readonly userId?: string; // present iff the port is user-scoped
  readonly category: string;
}

// A SEAM: the real backing is a per-firm `integration_connection` D1 repository, built with the first
// credentialed adapter. The registry depends only on this interface.
export interface ConnectionStore {
  getConnection(lookup: ConnectionLookup): Promise<IntegrationConnection | null>;
}
