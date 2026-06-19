---
category: Changed
---
**Integration platform — shared seams hoisted to platform-neutral homes.** The `HttpClient` transport seam (and its `fetch`-backed client) moved from the EasyPost adapter into `@magna-carta/integrations/http` — it is the transport every credentialed adapter builds on, not EasyPost-specific — and the per-firm secret-store seam moved from `apps/worker/src/shipping/` into `apps/worker/src/plugins/secret-store.ts`, since it backs the `CredentialStore` for every plugin. The worker core now builds the `PluginRuntime` from neutral homes and imports nothing from an individual plugin, with a new manifest-fitness guard enforcing it. No re-export shims left behind.
