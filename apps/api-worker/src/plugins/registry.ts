import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";
import { createConnectionStore } from "@magna-carta/data-access/integration-connection-store";
import type { IntegrationManifest } from "@magna-carta/integrations/manifest";
import {
  createIntegrationRegistry,
  type IntegrationRegistry,
} from "@magna-carta/integrations/registry";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../http/chokepoint/chokepoint.ts";
import type { AppVariables } from "../http/chokepoint/ports.ts";
import type { PluginRuntime } from "./runtime.ts";
import { parcelsManifest } from "@magna-carta/government-links/manifest";
import { propertyLinksManifest } from "@magna-carta/property-links/manifest";
import { shippingPlugin } from "./shipping-plugin.ts";

type PluginApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// A worker's binding of a pure manifest to its worker-coupled wiring: the Hono route registration
// and the per-request adapter construction. The manifest is reusable/transport-agnostic; this pairs
// it with the in-process worker. Adding a plugin = author its manifest + one WorkerPlugin entry here.
export interface WorkerPlugin {
  readonly manifest: IntegrationManifest;
  registerRoutes?(app: PluginApp, chokepoint: Chokepoint, runtime: PluginRuntime): void;
  registerAdapter?(registry: IntegrationRegistry, runtime: PluginRuntime): void;
}

// THE single place the worker learns a plugin exists. Populated as each integration is wired:
// shipping first (credentialed), then parcels and property-links (catalog-only).
export const workerPlugins: readonly WorkerPlugin[] = [
  shippingPlugin,
  { manifest: parcelsManifest },
  { manifest: propertyLinksManifest },
];

export function listManifests(): readonly IntegrationManifest[] {
  return workerPlugins.map((plugin) => plugin.manifest);
}

// One integration registry per request, over the firm's connection rows and its integration_credential
// store, with every plugin's adapter registered.
// Both stores resolve from the one per-request context, so a connection and the credential it names
// can never address different firms.
export function buildIntegrationRegistry(
  context: ProtectedReadContext,
  runtime: PluginRuntime,
): IntegrationRegistry {
  const registry = createIntegrationRegistry({
    // The same per-firm handle the credential read is scoped to: BatchDatabase extends SqlDatabase,
    // so one context addresses both stores and they cannot drift onto different firms.
    connectionStore: createConnectionStore(context.database),
    credentialStore: runtime.credentialStoreForFirm(context),
  });
  for (const plugin of workerPlugins) plugin.registerAdapter?.(registry, runtime);
  return registry;
}
