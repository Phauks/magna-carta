import { DurableObject } from "cloudflare:workers";
import { resolveStoredSecrets } from "@magna-carta/worker-secrets/stored-secrets";
import type { Bindings } from "./bindings.ts";

// Every secret this Worker reads. Each may be a per-Worker secret or a Secrets Store binding named
// SECRETS_STORE_<NAME>; resolveApiWorkerSecrets turns the store bindings back into the strings the
// rest of the Worker reads (packages/worker-secrets/src/stored-secrets.ts). A secret missing from
// this list is never looked for in the store. MICROSOFT_CLIENT_ID, MICROSOFT_TENANT,
// CLOUDFLARE_ACCOUNT_ID and FILES_INGEST_QUEUE_ID are not confidential, but they are set in the
// dashboard rather than committed, so they may be kept in the store beside their partners.
export const API_WORKER_SECRET_NAMES = [
  "AUTH_SECRET",
  "PLATFORM_ADMIN_KEY",
  "ROOT_KEK",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER",
  "R2_S3_ACCESS_KEY_ID",
  "R2_S3_SECRET_ACCESS_KEY",
  "FILES_INGEST_QUEUE_ID",
  "USAGE_ANALYTICS_PEPPER",
  "COMMUNITY_HANDOFF_SECRET",
  "PANGRAM_API_KEY",
  "ANTHROPIC_MODELS_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT",
  "SMARTY_AUTH_ID",
  "SMARTY_AUTH_TOKEN",
  "TELNYX_API_KEY",
  "REALTIME_TURN_TOKEN_ID",
  "REALTIME_TURN_TOKEN_SECRET",
  "REALTIME_SFU_APP_ID",
  "REALTIME_SFU_APP_SECRET",
  "MEETING_SINK_SIGNING_KEY",
  "OBSERVABILITY_API_TOKEN",
] as const;

export function resolveApiWorkerSecrets(env: Bindings): Promise<Bindings> {
  return resolveStoredSecrets(env, API_WORKER_SECRET_NAMES);
}

// The base every Durable Object here extends instead of DurableObject. The runtime hands a Durable
// Object the raw environment, so a secret bound from the store would reach it as a binding, not a
// string; this resolves them before any call is delivered. A subclass whose own constructor starts
// work that reads a secret awaits `storedSecretsReady` first, because blockConcurrencyWhile holds
// back calls, not other constructor work.
export abstract class StoredSecretsDurableObject extends DurableObject<Bindings> {
  protected readonly storedSecretsReady: Promise<void>;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.storedSecretsReady = ctx.blockConcurrencyWhile(async () => {
      this.env = await resolveApiWorkerSecrets(env);
    });
  }
}
