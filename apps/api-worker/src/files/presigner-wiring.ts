import type { Bindings } from "../bindings.ts";
import { createDevR2Presigner, createR2Presigner, type R2Presigner } from "./presign.ts";

// The account-scoped R2 S3 credential set the real SigV4 presigner signs direct-to-R2 URLs with. All
// three must be present and non-empty for real presigning: the account id is the S3 endpoint host, and
// the access-key pair is the signing secret. .dev.vars carries R2_S3_* placeholders (to satisfy the
// secrets.required deploy gate) but deliberately omits CLOUDFLARE_ACCOUNT_ID, so local dev and the
// Miniflare test pool never see a complete set — see the .dev.vars header and app.ts Bindings.
export interface RealR2Credentials {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

// The complete credential set, or null when any member is absent/empty. A single home for the check so
// the presigner selection and the development upload route agree byte-for-byte on when real R2 is in
// play (they must: the route may write bytes only where real presigning is NOT the transport).
export function realR2Credentials(env: Bindings): RealR2Credentials | null {
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
    return { accountId, accessKeyId, secretAccessKey };
  }
  return null;
}

// True when the local development upload emulation is the active upload transport — i.e. the real R2 S3
// credential set is absent, so presignerForEnv returns the dev presigner (worker-origin upload URLs)
// rather than the SigV4 one. This is a FAIL-CLOSED signal, not a togglable flag: a production deploy
// cannot sign a real presigned upload without those credentials (real uploads would be dead), so the
// dev presigner being in use always implies real presigning is non-functional. routes/dev-r2-upload.ts
// serves its route only on this condition — the same predicate that selects the presigner, so the two
// can never disagree and the route can never activate where a real presigned upload would work.
export function devUploadEmulationActive(env: Bindings): boolean {
  return realR2Credentials(env) === null;
}

// Adapter selection (the presigner twin of firm-provisioner-wiring.ts's resourceProviderForEnv):
// the FULL credential set present → the real SigV4 presigner; otherwise the dev presigner, which
// reroutes the upload leg to the Worker itself so `wrangler dev` (no resolvable presigned R2 host, no
// R2 object-create event) still runs the identical four-step ceremony end to end.
export function presignerForEnv(env: Bindings): R2Presigner {
  const credentials = realR2Credentials(env);
  if (credentials !== null) {
    return createR2Presigner(credentials);
  }
  return createDevR2Presigner(env);
}
