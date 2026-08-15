---
branch: claude/shipment-refusal
worktree: .claude/worktrees/shipment-refusal
area: shipping refuses the unbuilt credential read instead of throwing
status: review
touches: packages/integrations, packages/shipping, apps/worker/src/routes/shipping.ts, apps/worker/src/plugins, apps/worker/openapi/openapi.json, packages/api-client, roadmap.d/integrations.md, docs/deploy-queue.md, docs/user/features/shipping.md
---

# claude/shipment-refusal

**Scope.** Shipping's unbuilt per-firm credential read refused honestly instead of throwing. The
seam itself stays unbuilt: this makes its absence a typed `Dispatch` outcome the routes map to a
`501`, rather than a `500` arriving after a member has already drafted a shipment. Adds
`credential-store-not-implemented` to the integration framework's dispatch reasons and the
`unbuiltCredentialStore` value the registry takes in the credential-store slot. Builds no credential
store, no shipping UI, and no webhook ingress.

**Files expected to touch**

- `packages/integrations/src/dispatch.ts` — the fourth failure reason and its constructor
- `packages/integrations/src/credentials.ts` — `unbuiltCredentialStore` and its guard
- `packages/integrations/src/registry.ts` — resolve answers the new reason before the connection lookup
- `packages/integrations/test/` (dispatch, registry) and `packages/integrations/CLAUDE.md`
- `apps/worker/src/plugins/secret-store.ts` — `SecretStoreForFirm` returns `SecretStore | null`
- `apps/worker/src/plugins/registry.ts` — null becomes the unbuilt-store value
- `apps/worker/src/routes/shipping.ts` — the connect guard, the `501` mapping, the declared responses
- `apps/worker/src/app.ts` — one comment on the plugin-runtime default
- `apps/worker/test/shipping-unbuilt-credential-seam.test.ts` (new) — the production-default sequence
- `packages/shipping/test/registry-resolution.test.ts`, `packages/shipping/CLAUDE.md`
- `apps/worker/openapi/openapi.json` + `packages/api-client/src/types.gen.ts` — both generated
- `roadmap.d/integrations.md` — the `integrations.shipping.easypost-adapter` note
- `changelog.d/`, `docs/decisions/pending/` — fragments only

**Not touched.** The EasyPost adapter and its mapping, the shipment schema and data-access layer, the
purchase-claim guard, the label R2 path, `packages/data-access/src/firm-secret-credential-store.ts`.
No problem type was added — the refusal reuses the registered `not-implemented` key.

**Overlap watch.** `roadmap.d/integrations.md` is the one shared file; the generated `openapi.json`
and `packages/api-client` move because the shipping routes declare a new response. Nothing here edits
`CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, the white paper, or `docs/conventions/`.
