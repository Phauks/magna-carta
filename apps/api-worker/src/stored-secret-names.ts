// Every secret this Worker reads. Kept apart from stored-secrets.ts, which imports the Workers
// runtime, so a module that only needs the names (the System Status roster) stays runtime-free.
// Each may be a per-Worker secret or a Secrets Store binding named
// SECRETS_STORE_<NAME>; resolveApiWorkerSecrets turns the store bindings back into the strings the
// rest of the Worker reads (packages/worker-secrets/src/stored-secrets.ts). A secret missing from
// this list is never looked for in the store. MICROSOFT_CLIENT_ID, MICROSOFT_TENANT, GOOGLE_CLIENT_ID,
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
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SMARTY_AUTH_ID",
  "SMARTY_AUTH_TOKEN",
  "GOOGLE_PLACES_API_KEY",
  "TELNYX_API_KEY",
  "REALTIME_TURN_TOKEN_ID",
  "REALTIME_TURN_TOKEN_SECRET",
  "REALTIME_SFU_APP_ID",
  "REALTIME_SFU_APP_SECRET",
  "MEETING_SINK_SIGNING_KEY",
  "OBSERVABILITY_API_TOKEN",
] as const;
