import { createFirmSecretCredentialStore } from "@magna-carta/data-access/firm-secret-credential-store";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { createConnectionStore } from "@magna-carta/data-access/integration-connection-store";
import { unbuiltCredentialStore } from "@magna-carta/integrations/credentials";
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

// One integration registry per request, over the firm's D1 (ConnectionStore) + its firm_secret
// CredentialStore, with every plugin's adapter registered. Replaces the shipping-specific builder.
// A deployment whose per-firm secret read is not wired yet hands the registry the framework's
// unbuilt-store value, so every credentialed operation refuses by name instead of the construction
// blowing up on the first request that needed one.
export function buildIntegrationRegistry(
  firmDatabase: SqlDatabase,
  runtime: PluginRuntime,
): IntegrationRegistry {
  const secrets = runtime.secretStoreForFirm(firmDatabase);
  const registry = createIntegrationRegistry({
    connectionStore: createConnectionStore(firmDatabase),
    credentialStore:
      secrets === null ? unbuiltCredentialStore : createFirmSecretCredentialStore(secrets),
  });
  for (const plugin of workerPlugins) plugin.registerAdapter?.(registry, runtime);
  return registry;
}
