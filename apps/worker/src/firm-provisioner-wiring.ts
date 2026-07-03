import type { Bindings } from "./app.ts";
import {
  createCloudflareRestFirmResourceProvider,
  createDevFirmResourceProvider,
  type FirmResourceProvider,
} from "./firm-resource-provider.ts";

// The env → FirmResourceProvider factory: how the worker wires the provisioner's resource port to
// real bindings. Lives beside the provisioner so routes/firms.ts stays at route altitude. The
// firm's per-firm database needs no wiring — it is the firmId-addressed FirmDatabase Durable
// Object, which self-migrates on first access.

// Adapter selection: deploy-time credentials present → real Cloudflare REST creation; otherwise
// the dev adapter (local dev and tests — CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID are
// deploy-time secrets, deliberately absent from .dev.vars).
export function resourceProviderForEnv(env: Bindings): FirmResourceProvider {
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (apiToken !== undefined && apiToken !== "" && accountId !== undefined && accountId !== "") {
    return createCloudflareRestFirmResourceProvider({
      accountId,
      apiToken,
      eventNotificationQueueId: env.FILES_INGEST_QUEUE_ID,
    });
  }
  return createDevFirmResourceProvider();
}
