# Integration platform foundation — design (Spec 1)

**Status:** Designed (brainstormed 2026-06-17). Awaiting plan.

**Goal.** Decouple integrations ("plugins") from the platform core so that adding, expanding, reducing, or removing one is cheap and local. Today the core _contains_ knowledge of each plugin in roughly a dozen files; this spec inverts that: each integration package exports one declarative **`IntegrationManifest`**, and the core holds a **registry that enumerates manifests** and drives wiring (route mounting, per-request adapter resolution, and — in Spec 2 — the marketplace) off them. The manifest is **transport-agnostic**, so the eventual move to isolated plugin Workers (see the C-seam ADR) swaps the transport beneath the same contract.

**Non-goals (deferred).** The marketplace management surface (catalog/enablement/settings/credentials/connect — **Spec 2**); per-Worker plugin isolation / Workers-for-Platforms (**the C seam — ADR only here, built when triggered**); any new vendor adapter.

**Scope at a glance.** The `IntegrationManifest` type + a central manifest registry; manifest-driven route mounting through the existing chokepoint; generalization of the per-request integration registry to build from manifests; migration of the three existing plugins (shipping = credentialed; parcels + property-links = credential-less) onto manifests; a well-formedness + decoupling fitness function; and the C-seam ADR. Backend only.

**Depends on (all present on `main`):** `@magna-carta/integrations` (registry, `Adapter`, `CapabilityDescriptor`, `ConnectionStore`, `CredentialStore`), `@magna-carta/shipping` / `@magna-carta/parcels` / `@magna-carta/property-links`, the ADR-0067 chokepoint, `defineOpenAPIRoute`/`RouteMeta`, and the OpenAPI emit + conformance machinery. No dependency on Spec 2 or any unbuilt work.

---

## The contract: `IntegrationManifest`

One manifest per integration package, pure data + declared capability — no D1, no Hono, no `env`:

```ts
interface IntegrationManifest {
  id: string; // stable adapter id, e.g. "easypost"
  category: string; // port category, e.g. "shipping"
  displayName: string; // catalog title — "EasyPost"
  summary: string; // one-line catalog description
  vendorUrl?: string; // optional "learn more" link

  credential: CredentialRequirement; // reused: { kind: "none" | "apiKey" | "oauth", scope: "firm" | "user" }
  capability: CapabilityDescriptor; // reused: operations supported (drives graceful degrade)

  permission: KnownPermission | null; // operational gate, e.g. "shipping:manage"; null for credential-less

  // Spec-2 fields, declared here so the contract is whole (unused by the core until the marketplace lands):
  defaultEnablement: "on" | "off"; // credential-less → "on"; credentialed → "off"
  connectSchema?: ZodType; // credential input shape at connect, e.g. { apiKey }
  settingsSchema?: ZodType; // per-firm config; defaults in code

  registerRoutes?: (app, chokepoint, runtime: PluginRuntime) => void; // the plugin's own routes
  adapter?: Adapter<unknown>; // the Port adapter, for credentialed resolution
}
```

Rationale for declaring the Spec-2 fields now: the manifest is the **single contract** the C seam preserves; defining it whole avoids reshaping it later. The core in Spec 1 reads only the structural fields (`id`/`category`/`permission`/`registerRoutes`/`adapter`/`credential`); the marketplace fields sit dormant until Spec 2.

### Central registry

One file lists every plugin's manifest in an array — the **only** place the core learns a plugin exists. It exposes:

- `listManifests(): readonly IntegrationManifest[]` — enumeration (catalog source; route-mount loop).
- `manifestFor(category): IntegrationManifest | undefined` — single-category resolution.

Adding a plugin = write its manifest + add one line to this index. (Its migration, permission, and identifier prefixes remain core-side registrations — those are genuine shared-resource concerns, not accidental coupling; see _Intrinsic vs accidental coupling_ below.)

### `PluginRuntime` — the uniform dependency seam

Plugin route handlers need firm-scoped capabilities (the resolved firm D1, R2, the `SecretStore`, an HTTP client, the per-request integration registry builder). Rather than bespoke `CreateAppOptions` wiring per plugin, the core hands every plugin one `PluginRuntime` accessor. **This is the exact seam the C boundary later replaces** — in-process it is direct calls; in C it is RPC over a service/dispatch binding. Plugin authors code against `PluginRuntime` either way.

`PluginRuntime` is built once in `createApp` from `env`, with a single test override on `CreateAppOptions` (an injectable `httpClient` + `secretStoreForFirm`) replacing today's per-plugin `shipping?` field. Existing plugin tests (the shipping e2e) use that one seam; every future plugin's tests get it for free.

---

## Manifest-driven route mounting

`app.ts` stops naming plugins. Core routes (health/me/members/firms/matters/files/…) stay hand-registered; plugins mount from the registry:

```ts
for (const manifest of listManifests()) {
  manifest.registerRoutes?.(app, chokepoint, pluginRuntime);
}
```

**Enforcement is unchanged.** Each plugin's `registerRoutes` wires every route through `chokepointMiddleware(chokepoint, route)` exactly as `shipping.ts` does today. The ADR-0067 chokepoint stays the single tenancy → authn → RBAC → idempotency → rate-limit enforcement point; only _registration_ became data-driven. This is the security-critical invariant the in-process model preserves (and the reason in-process beats per-Worker isolation for first-party plugins).

**The contract gets simpler.** The OpenAPI emitter and conformance suite already enumerate routes from the built app. Because manifest routes always register (no `if (options.shipping)` gate — that workaround is deleted), the emitted contract is complete by construction. The committed OpenAPI snapshot + generated client are regenerated; routes are byte-identical to today, only their mounting changed.

---

## Migrating the three existing plugins (the proof)

- **shipping (credentialed).** Export a manifest (`id: "easypost"`, `category: "shipping"`, `credential: {kind:"apiKey",scope:"firm"}`, `permission: "shipping:manage"`, `connectSchema: { apiKey }`, its routes, the EasyPost adapter). Delete the bespoke `app.ts` import, the `CreateAppOptions.shipping` field, and the conditional registration. The existing shipping e2e + conformance + snapshot tests must stay green through the new mounting — that is the validation.
- **parcels, property-links (credential-less).** Export manifests (`credential: {kind:"none"}`, `permission: null`, `defaultEnablement: "on"`). They have no connection and no routes today (pure libraries surfaced inside features), so their manifests are catalog-only for now — but they make the registry hold _both_ integration types from day one, which Spec 2's marketplace needs.

---

## Intrinsic vs accidental coupling

The refactor removes **accidental** coupling (route wiring, dependency injection, catalog knowledge) while leaving **intrinsic** shared-resource registrations core-side, because they cannot be a plugin's private concern:

- **Migrations** — one per-firm lineage, applied by the provisioner; a plugin that stores data adds a migration to that lineage.
- **Permissions** — a plugin's `permission` is a key in the one access-control registry; the manifest references it by name.
- **Identifiers** — a plugin's id prefixes live in the one identifier registry.

The C-seam ADR formalizes this boundary (what an isolated plugin Worker could own vs. what stays platform-owned: tenancy, the chokepoint, the migration lineage, the encryption custody root).

---

## Testing

- **Manifest registry** unit tests: `listManifests` enumerates all; `manifestFor` resolves by category.
- **Well-formedness + decoupling fitness** (the guard that keeps the decoupling from regressing): every manifest has a unique `id`/`category`, a valid `credential.kind`, and a `permission` that exists in the access-control registry (or `null`); and **`app.ts` imports no individual plugin route module by name** (a regression that re-couples the core fails CI).
- **Behavior preserved**: the shipping e2e, the conformance suite, and the OpenAPI snapshot/client all stay green — routes identical, mounting data-driven.

## Load profile

`[-]` — this slice adds no per-firm data surface (it is a structural refactor; the marketplace's per-firm rows arrive in Spec 2). Justified in `STATUS.md` Notes per the accretion rule.

## Docs & decisions (in-commit, golden rule 5/8)

- White-paper _Plugin / Add-on system_ updated to describe the manifest model and the transport progression.
- **ADRs:** (1) the integration-platform decoupling / manifest contract; (2) the C-transition seam (transport progression, `PluginRuntime` boundary, the hard problems C must solve, what stays platform-owned, the trigger). Recorded in `docs/Decision-Log.md` with assigned numbers at build time.
- STATUS / ROADMAP / CHANGELOG updated.

---

## The C seam (ADR content, recorded — not built)

- **Transport progression under one unchanged manifest:** in-process (this spec) → service bindings (C1, first-party multi-Worker) → Workers for Platforms (C2, the _untrusted third-party_ marketplace; confirmed as Cloudflare's "deploy serverless functions on behalf of your customers" model with dispatch namespaces).
- **`PluginRuntime` is the boundary contract:** in-process = direct; C = RPC. Authors code against it unchanged.
- **The hard problems C must solve** (documented so they are not improvised): per-firm D1 across Workers (bindings are per-Worker by `database_id` — a plugin Worker cannot be handed the core's resolved firm-DB connection); firm-key / credential custody across the boundary; distributed migration ownership (likely resolution: plugins _declare_ schema fragments the core applies to the single lineage, not per-Worker migrations); chokepoint-across-boundary (C1: core enforces then forwards trusted context; C2: per-Worker sandbox + re-check); aggregated OpenAPI across Workers; multi-Worker dev/test/deploy and WfP pricing.
- **Platform-owned at every stage:** tenancy resolution, the single chokepoint, the migration lineage, the encryption custody root.
- **Trigger:** the first untrusted/third-party plugin, or a plugin needing independent deploy cadence / sandboxing — not a calendar date.

---

## Follow-on: Spec 2 — Integration marketplace (separate spec)

Built on this foundation: a uniform per-firm **enablement** model (everything toggleable; stored in the per-firm `setting` table as `integration:<id>` → `{ enabled, settings }`, validated by `settingsSchema`); per-integration **settings**; **credentials** (connect/disconnect over `firm_secret`, with the _machine credential-read_ carve-out — a non-gated, non-audited firm-key decrypt used only by the framework's `CredentialStore`, while connect/disconnect stay audited under `integrations:manage`); an `EnablementStore` the registry consults so `resolve()` gates on enablement uniformly; the generic manifest-driven management routes under `/api/v1/integrations`; and a new `integrations:manage` permission. Brainstormed and specced after Spec 1 lands.
