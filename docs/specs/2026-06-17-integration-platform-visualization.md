# Integration platform — visual explainer (old wiring vs. the new manifest model)

**Audience:** anyone who wants the shape of the change without reading the code. This sits beside the
[design spec](2026-06-17-integration-platform-foundation-design.md) and its
[implementation plan](2026-06-17-integration-platform-foundation-implementation-plan.md); those two
are the authoritative detail. The diagrams below are grounded in the code as it stands today
(`apps/worker/src/app.ts`, `apps/worker/src/routes/communications/shipping.ts`, `apps/worker/src/shipping/registry.ts`)
and the model the design introduces.

The one-sentence story: **today the platform core _contains_ knowledge of each plugin — it imports
each plugin's routes by name, carries a per-plugin field in its options, and hard-codes the shipping
adapter into a per-request registry. The new model inverts that:** each plugin exports one declarative
`IntegrationManifest`, a single registry index enumerates them, and the worker mounts every plugin in
one loop through the same unchanged enforcement chokepoint. The core stops naming plugins; plugins
self-describe.

---

## 1. Old system — the core knows each plugin by name

Today, adding shipping meant teaching the core about shipping in several places at once. `app.ts`
imports `registerShippingRoutes` and `fetchHttpClient` directly; `CreateAppOptions` carries a
bespoke `shipping?` field; the registration is a hand-written call with an inline default-deps
fallback; and `routes/communications/shipping.ts` reaches back into a shipping-specific `buildShippingRegistry` that
hard-codes `createEasyPostAdapter`. Every one of those is a thread tying the core to this one plugin —
so a second plugin re-creates every thread.

```mermaid
flowchart TB
  subgraph core["Platform core (knows shipping by name)"]
    app["app.ts<br/>imports registerShippingRoutes<br/>imports fetchHttpClient"]
    opts["CreateAppOptions<br/>shipping?: ShippingRouteDeps field"]
    reg["inline registration<br/>registerShippingRoutes(app, chokepoint,<br/>options.shipping ?? default-deps)"]
    chk["chokepoint<br/>(single enforcement point)"]
  end

  subgraph plugin["Shipping plugin surface"]
    routes["routes/communications/shipping.ts<br/>ShippingRouteDeps + 7 routes"]
    shimreg["shipping/registry.ts<br/>buildShippingRegistry()<br/>hard-codes createEasyPostAdapter"]
    adapter["@magna-carta/shipping<br/>EasyPost adapter"]
  end

  app -->|"import by name"| routes
  app -->|"import by name"| adapter
  opts -.->|"per-plugin field"| routes
  reg -->|"hand-wired call"| routes
  routes -->|"per request"| shimreg
  shimreg -->|"hard-codes"| adapter
  routes -->|"each route registers through"| chk

  classDef coreNode fill:#e8edff,stroke:#3a4fb0,color:#1a2a6b;
  classDef pluginNode fill:#fff0e6,stroke:#c4641e,color:#6b3410;
  class app,opts,reg,chk coreNode;
  class routes,shimreg,adapter pluginNode;
```

Read the edges as the coupling: the core has **four** distinct references into the one plugin
(named route import, named adapter import, a per-plugin options field, a per-plugin registry helper).
A second plugin would draw the same four edges again — coupling grows with the number of plugins.

---

## 2. New system — the core knows only the registry; plugins self-describe

Each plugin package now exports one pure `IntegrationManifest` (id, category, credential shape,
capability, permission, and — for the worker-coupled ones — its route registration and adapter). A
single worker-side index, `workerPlugins`, is **the only place the core learns a plugin exists**.
`app.ts` mounts every plugin in one loop; `buildIntegrationRegistry` builds the per-request registry
by looping the same list. The chokepoint is untouched — each plugin still registers every route
through it. The core names no plugin.

```mermaid
flowchart TB
  subgraph core["Platform core (names no plugin)"]
    app["app.ts<br/>for (plugin of workerPlugins)<br/>plugin.registerRoutes(app, chokepoint, runtime)"]
    rt["PluginRuntime<br/>(uniform dependency seam:<br/>httpClient + secretStoreForFirm)"]
    bir["buildIntegrationRegistry()<br/>loops plugins, registers each adapter"]
    chk["chokepoint<br/>(single enforcement point — UNCHANGED)"]
  end

  subgraph index["plugins/registry.ts — the one index"]
    list["workerPlugins: WorkerPlugin[]<br/>listManifests()"]
  end

  subgraph plugins["Plugins (each self-describes via one manifest)"]
    ship["shippingManifest<br/>(credentialed: apiKey/firm,<br/>routes + EasyPost adapter)"]
    parc["parcelsManifest<br/>(credential-less, catalog-only)"]
    prop["propertyLinksManifest<br/>(credential-less, catalog-only)"]
  end

  app -->|"enumerates"| list
  bir -->|"enumerates"| list
  list --> ship
  list --> parc
  list --> prop
  app -->|"builds + hands down"| rt
  rt -.->|"injected into"| ship
  app -->|"every route still through"| chk

  classDef coreNode fill:#e8edff,stroke:#3a4fb0,color:#1a2a6b;
  classDef indexNode fill:#e6f7ec,stroke:#1e8a4c,color:#0f4d2a;
  classDef pluginNode fill:#fff0e6,stroke:#c4641e,color:#6b3410;
  class app,rt,bir,chk coreNode;
  class list indexNode;
  class ship,parc,prop pluginNode;
```

The inversion: the core now has exactly **one** outbound reference — to `workerPlugins`. Plugins
point _into_ the registry (self-registration); the core does not reach out to name any of them. Adding
the fourth and fifth plugin adds rows to the list, not edges from the core.

---

## 3. Adding a plugin — before vs. after

The clearest measure of the decoupling is what it costs to add one integration. The diagram pairs the
two worlds; the table lists the concrete files.

```mermaid
flowchart LR
  subgraph before["BEFORE — ~a dozen core edits"]
    direction TB
    b1["edit app.ts: import routes by name"]
    b2["edit app.ts: import adapter/http by name"]
    b3["add CreateAppOptions field for the plugin"]
    b4["add the hand-wired registration block"]
    b5["write a plugin-specific buildXRegistry"]
    b6["wire deps + default fallback in app.ts"]
    b7["update index.ts plugin option"]
    b8["update every test's per-plugin injection"]
    b1 --> b2 --> b3 --> b4 --> b5 --> b6 --> b7 --> b8
  end

  subgraph after["AFTER — a manifest + one line"]
    direction TB
    a1["write the plugin's IntegrationManifest"]
    a2["add one WorkerPlugin row to workerPlugins"]
    a3["(intrinsic, unchanged) register migration,<br/>permission key, identifier prefix"]
    a1 --> a2 --> a3
  end

  classDef beforeNode fill:#ffe6e6,stroke:#c0392b,color:#6b1a14;
  classDef afterNode fill:#e6f7ec,stroke:#1e8a4c,color:#0f4d2a;
  class b1,b2,b3,b4,b5,b6,b7,b8 beforeNode;
  class a1,a2,a3 afterNode;
```

| Concern               | Before (core edits per plugin)                                               | After                                                                             |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Route wiring          | `app.ts` imports `registerShippingRoutes`, hand-writes the registration call | `manifest.registerRoutes` — mounted by the existing loop, no `app.ts` edit        |
| Dependencies          | `CreateAppOptions.shipping?` field + inline default-deps fallback            | one shared `PluginRuntime`, injected to every plugin                              |
| Adapter resolution    | plugin-specific `buildShippingRegistry` hard-coding `createEasyPostAdapter`  | `buildIntegrationRegistry` loops `workerPlugins` and calls each `registerAdapter` |
| Catalog knowledge     | none (no catalog existed)                                                    | one `IntegrationManifest` the registry enumerates                                 |
| Discoverability       | scattered across `app.ts` / `index.ts` / `routes` / `shipping/registry.ts`   | one row in `workerPlugins`                                                        |
| **Migrations**        | core-side                                                                    | **core-side (unchanged — intrinsic)**                                             |
| **Permission key**    | core-side                                                                    | **core-side (unchanged — intrinsic)**                                             |
| **Identifier prefix** | core-side                                                                    | **core-side (unchanged — intrinsic)**                                             |

The bottom three rows are deliberate: migrations, permission keys, and identifier prefixes are
_intrinsic_ shared-resource concerns (one per-firm migration lineage, one access-control registry, one
identifier registry). They cannot be a plugin's private business, so they stay platform-owned in both
worlds. Only the **accidental** coupling — route wiring, dependency plumbing, catalog knowledge —
collapses to a manifest plus one index line.

---

## 4. The C seam — transport progression (future, NOT being built now)

The manifest is deliberately **transport-agnostic**, and `PluginRuntime` is the boundary every plugin
codes against. That makes a future move to isolated plugin Workers a _transport swap beneath the same
contract_ — the manifest never changes. The design records this as the "C seam." **Only the in-process
stage (left) is being built now;** C1 and C2 are documented in an ADR so they are not improvised later,
not scheduled.

```mermaid
flowchart LR
  subgraph now["IN-PROCESS  —  building NOW"]
    direction TB
    n_core["Platform core Worker"]
    n_plug["Plugins (same Worker)"]
    n_core -->|"PluginRuntime = direct calls"| n_plug
  end

  subgraph c1["C1  —  service bindings (first-party multi-Worker)"]
    direction TB
    c1_core["Platform core Worker"]
    c1_plug["First-party plugin Worker"]
    c1_core -->|"PluginRuntime = RPC over service binding<br/>core enforces, then forwards trusted context"| c1_plug
  end

  subgraph c2["C2  —  Workers for Platforms (untrusted marketplace)"]
    direction TB
    c2_core["Platform core Worker"]
    c2_disp["Dispatch namespace"]
    c2_plug["Third-party plugin Worker<br/>(sandboxed, re-checks)"]
    c2_core -->|"PluginRuntime = RPC"| c2_disp --> c2_plug
  end

  now ==>|"same IntegrationManifest"| c1
  c1 ==>|"same IntegrationManifest"| c2

  classDef nowNode fill:#e6f7ec,stroke:#1e8a4c,color:#0f4d2a;
  classDef futureNode fill:#f0f0f0,stroke:#888,color:#444,stroke-dasharray: 5 4;
  class n_core,n_plug nowNode;
  class c1_core,c1_plug,c2_core,c2_disp,c2_plug futureNode;
```

The dashed grey stages are not in scope. What stays constant across all three: the manifest contract,
and the fact that `PluginRuntime` is _where_ the transport lives — direct calls in-process, RPC across
a binding in C. Plugin authors never see the difference. The hard problems C must solve (per-firm D1
across Workers, credential custody across the boundary, distributed migration ownership, enforcing the
chokepoint across the boundary, aggregating one OpenAPI contract) are catalogued in the design spec and
its C-seam ADR. The trigger is the first untrusted/third-party plugin — not a date.

---

## 5. Impact summary

**What gets decoupled (accidental coupling removed):**

- **Route wiring** — `app.ts` stops importing any plugin's routes by name; one loop mounts them all.
- **Dependency plumbing** — the per-plugin `CreateAppOptions.shipping?` field and its inline default
  fallback are replaced by one shared `PluginRuntime` injected into every plugin.
- **Catalog / adapter knowledge** — the shipping-specific `buildShippingRegistry` (deleted) becomes
  `buildIntegrationRegistry`, which loops the plugin list; the core no longer hard-codes any adapter.
- **Discoverability** — "what plugins exist" moves from four scattered files to one `workerPlugins` index.

**What stays platform-owned (intrinsic — unchanged on purpose):**

- **Tenancy resolution** — firm-context resolution stays in the core, at every stage.
- **The single chokepoint** — the one tenancy → authn → RBAC → idempotency → rate-limit enforcement
  point; _only route registration_ became data-driven, never enforcement.
- **Migration lineage** — one per-firm lineage applied by the provisioner; a plugin contributes a
  migration to it, it does not own its own.
- **Encryption custody root** — the firm-key / credential custody stays with the platform.

**The security invariant preserved:** there is still exactly **one enforcement point**. Every plugin
route — mounted by the loop instead of by a hand-written call — registers through
`chokepointMiddleware(chokepoint, route)` exactly as before. Making _registration_ data-driven did not
add a path that skips the chokepoint; the fitness test that fails CI if `app.ts` ever re-imports a
plugin route by name guards the decoupling from regressing.

```

```
