import {
  createFirmSecretCredentialStore,
  type SecretStore,
} from "@magna-carta/data-access/firm-secret-credential-store";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { createConnectionStore } from "@magna-carta/data-access/integration-connection-store";
import {
  createIntegrationRegistry,
  type IntegrationRegistry,
} from "@magna-carta/integrations/registry";
import { createEasyPostAdapter } from "@magna-carta/shipping/easypost";
import { fetchHttpClient, type HttpClient } from "@magna-carta/shipping/easypost/http";

// One registry per request, over the firm's D1 (ConnectionStore) and its firm_secret CredentialStore.
// The HttpClient is injectable so tests pass a fake EasyPost.
export function buildShippingRegistry(
  firmDatabase: SqlDatabase,
  secretStore: SecretStore,
  http: HttpClient = fetchHttpClient(),
): IntegrationRegistry {
  const registry = createIntegrationRegistry({
    connectionStore: createConnectionStore(firmDatabase),
    credentialStore: createFirmSecretCredentialStore(secretStore),
  });
  registry.register(createEasyPostAdapter({ http }));
  return registry;
}
