import type { Bindings } from "./bindings.ts";
import {
  createCloudflareRestFirmResourceProvider,
  createDevFirmResourceProvider,
  type FirmResourceProvider,
} from "./firm-resource-provider.ts";

// The env → FirmResourceProvider factory: how the worker wires the provisioner's resource port to
// real bindings. Lives beside the provisioner so routes/platform/firms.ts stays at route altitude. The
// firm's per-firm database needs no wiring — it is the firmId-addressed FirmDatabase Durable
// Object, which self-migrates on first access.

// Adapter selection: deploy-time credentials present → real Cloudflare REST creation; otherwise
// the dev adapter (local dev and tests — CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER/CLOUDFLARE_ACCOUNT_ID are
// deploy-time secrets, deliberately absent from .dev.vars). A DEPLOYMENT cannot land here without
// them: both are in wrangler.jsonc's secrets.required, because a production Worker that took this
// branch recorded a bucket name for every firm it provisioned and created no bucket, and nothing
// said so until the firms could not upload. The fact of which adapter ran is carried on the
// provider (`kind`) so the upload-readiness report can state it rather than infer it.
export function resourceProviderForEnv(env: Bindings): FirmResourceProvider {
  const apiToken = env.CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (apiToken !== undefined && apiToken !== "" && accountId !== undefined && accountId !== "") {
    return createCloudflareRestFirmResourceProvider({
      accountId,
      apiToken,
      eventNotificationQueueId: env.FILES_INGEST_QUEUE_ID,
      browserOrigins: browserOriginsForEnv(env),
    });
  }
  return createDevFirmResourceProvider();
}

// The origin this deployment serves the app from, joining the checked-in CORS artifact's list on
// every firm bucket — so a deployment at an address the artifact does not name still takes browser
// uploads. An unparseable value contributes nothing rather than a rule the API would refuse.
function browserOriginsForEnv(env: Bindings): string[] {
  const base = env.APP_BASE_URL;
  if (base === undefined || base === "") return [];
  try {
    return [new URL(base).origin];
  } catch {
    return [];
  }
}
