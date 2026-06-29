# cloudflare-api-token-naming

**Scope:** Rename the worker's firm-provisioning Cloudflare API token secret from the generic
`CLOUDFLARE_API_TOKEN` to `CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER`, establishing the
`CLOUDFLARE_API_TOKEN_<purpose>` convention so the worker can hold several distinct, individually
rotatable Cloudflare API tokens. Pure rename — no behaviour change.

**Files touched:**

- `apps/worker/src/app.ts` (Bindings type)
- `apps/worker/src/firm-provisioner-wiring.ts` (the `env` read + comment)
- `apps/worker/src/firm-resource-provider.ts` (comment)
- `apps/worker/.dev.vars` + `apps/worker/test/dev-vars.test.ts` (byte-identical placeholder guard)
- `apps/worker/wrangler.jsonc` (comment)
- `docs/conventions/operations.md`, `docs/conventions/security.md` (secrets posture)

**Deliberately NOT touched:** the scan-worker CI deploy `CLOUDFLARE_API_TOKEN` references
(`operations.md` scan section, `scan-service-extraction-design.md`) — a separate credential — and
historical specs.

**Deploy sequencing:** the live worker reads the deployed name, so the new-named secret must be set
before this ships, and the old `CLOUDFLARE_API_TOKEN` secret stays until the rename deploys.
