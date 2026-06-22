import type { HttpClient } from "@magna-carta/integrations/http";
import type { SecretStoreForFirm } from "./secret-store.ts";

// The uniform, app-level dependency seam every plugin's routes/adapters code against — built once in
// createApp from env, overridable in tests. This is the exact boundary the future per-Worker
// transport (the C seam) replaces with RPC: in-process it is direct, in C it crosses a binding.
// Both deps are platform-neutral (no plugin named here): the transport client and the per-firm
// secret-store seam that backs the shared CredentialStore.
export interface PluginRuntime {
  readonly httpClient: HttpClient;
  readonly secretStoreForFirm: SecretStoreForFirm;
}
