import type { Bindings } from "../app.ts";
import { createDevR2Presigner, createR2Presigner, type R2Presigner } from "./presign.ts";

// Adapter selection (the presigner twin of firm-provisioner-wiring.ts's resourceProviderForEnv):
// the FULL credential set present (account id + R2 S3 token) → the real SigV4 presigner; otherwise
// the dev presigner. CLOUDFLARE_ACCOUNT_ID is deliberately absent from .dev.vars (the same deploy-
// time secret the REST FirmResourceProvider needs), so local dev and the Miniflare tests run the dev
// presigner and never touch the network — even though the R2_S3_* placeholders are present.
export function presignerForEnv(env: Bindings): R2Presigner {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = env.R2_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_S3_SECRET_ACCESS_KEY;
  if (
    accountId !== undefined &&
    accountId !== "" &&
    accessKeyId !== undefined &&
    accessKeyId !== "" &&
    secretAccessKey !== undefined &&
    secretAccessKey !== ""
  ) {
    return createR2Presigner({ accountId, accessKeyId, secretAccessKey });
  }
  return createDevR2Presigner();
}
