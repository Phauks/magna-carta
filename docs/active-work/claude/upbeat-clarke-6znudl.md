---
worktree: C:/dev/magna-carta-worktrees/claude/upbeat-clarke-6znudl
area: Upload readiness — the deploy gate requires the provisioning credentials; one server-side check, one button, names why an upload cannot reach storage
status: review
touches: apps/api-worker/wrangler.jsonc, apps/api-worker/src/files, apps/api-worker/src/routes, apps/api-worker/src/firm-resource-provider.ts, apps/api-worker/openapi, packages/api-client, apps/web/src/lib/file-manager, apps/web/src/routes/(app)/settings/file-safety, docs/specs, docs/decisions/pending, docs/conventions/operations.md, docs/user/admin
---

`CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER` and `CLOUDFLARE_ACCOUNT_ID` join `secrets.required`, so a
deployment cannot run the development adapters against real firms. `files/upload-readiness.ts` +
`POST /api/v1/firm/upload-readiness` verify the six preconditions of a browser upload from the
server, re-applying the settings the code owns and naming a missing bucket or a mis-scoped key;
the version panel runs it with its other reads and shows the report as its fourth section. The first real upload then exposed the scan cold start: warm-poke on, interactive scans pinned to the warm shard, backed-off ingest retries. Then the owner's duplicate ruling: identical bytes still file a new copy; a taken name is the reader's call (keep both, new version, skip). Earlier on this branch: the pre-launch reset
script, the resource manifest, the bucket-scoped object-plane credential, and the runbook's
key-scope correction. Deferred: the presigner joining the scoped credential.
