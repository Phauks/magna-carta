import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";
import type { HttpClient } from "@magna-carta/shipping/easypost/http";

// The uniform, app-level dependency seam every plugin's routes/adapters code against — built once in
// createApp from env, overridable in tests. This is the exact boundary the future per-Worker
// transport (the C seam) replaces with RPC: in-process it is direct, in C it crosses a binding.
export interface PluginRuntime {
  readonly httpClient: HttpClient;
  // The slice-1·2 firm_secret store, per firm database. Production passes the real store; until the
  // marketplace wires the live credential read it is the throwing seam; tests inject a fake.
  readonly secretStoreForFirm: (firmDatabase: unknown) => SecretStore;
}
