# Tools area — design

**Status:** Accepted (design) · **Date:** 2026-06-16 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ (build-in-vs-plugin rule; "pure utilities are libraries, not plugins")
**ADRs:** **ADR-0097 (the Tools layer — a presentation/IA catalog above the integration framework; library-vs-integration tool backing — new)** · builds on ADR-0091/0092 (integration port system + connection model), ADR-0093 (property external-links), ADR-0068 (access control), ADR-0015 (uniform plugin model).

A growing set of first-party utilities — county property links, Secretary-of-State business lookups, attorney-license lookups, shipping/postage, an Avery template printer, and a family of diagnostics (a network speed test, firm usage/storage, server-connectivity checks, platform uptime) — currently has no shared home and no consistent way to be discovered. This design adds a **Tools** area: a top-level left-nav destination that catalogs these utilities and surfaces each one both **generally** (a permanent, discoverable place) and **contextually** (where it is relevant — an address tool on a Location, a person tool on a Directory entity). The catalog is one source of truth feeding both surfaces.

This is a **presentation / information-architecture layer only**. It does no outbound work itself: it sits *above* the packages that already exist — pure libraries for the link tools, the integration framework for the connected ones — and never touches credentials, connections, or vendor APIs.

**Build gates:** the two UI surfaces gate on the design-system shell (slice 0·7a — no left nav exists yet); this design is the spec that feeds that work. The pure catalog package and its selectors have **no UI dependency and are buildable now**, with manifests for the tools that already exist.

---

## 0. Why a Tools layer (ADR-0097)

The integration framework (`@magna-carta/integrations`) answers a **backend** question: _can we perform capability X for this firm, behind a typed port, with what credential and connection health?_ Its registry is keyed `category → one adapter`, resolves to a `port + descriptor`, and returns a typed `Dispatch` (`not-connected` / `capability-unsupported` / `adapter-error`).

"What tools does a user see, what are they grouped under, who is allowed, and where do they appear?" is a different, **presentation** question — orthogonal to capability and credential. Answering it inside the integration framework would force two unrelated concerns together and, worse, drag pure utilities through ports they do not need. The framework's own rule (_Marketplace seam_) and the white paper both say **pure utilities are libraries, not plugins** — `property-links` and `government-links` construct plain `https` links with no port, no credential, no API call.

So the Tools layer is **a thin catalog above the framework**, not part of it:

```
Tool catalog entry
 ├─ backing: "library"      → pure package, no connection      (property-links, government-links, Avery)
 └─ backing: "integration"  → references an integration category (shipping → ShippingPort/EasyPost)
        the Tools UI reflects that integration's Dispatch/health:
        not-connected → "Connect…"; capability-unsupported → disable that op
```

The catalog is the **only** place library-tools and integration-tools mix; below it they stay separate. The two descriptors are complementary, not duplicative: the integration `CapabilityDescriptor` carries `category / operations / credential` (technical); a tool manifest carries `subjectGroup / contextTags / permission / entry` (presentational). An integration-backed tool simply carries both — its manifest plus a pointer to the integration `category` it reflects.

## 1. Module placement

Mirroring the codebase's structure-vs-UI seam (ADR-0071):

- **`@magna-carta/tools`** — new **pure** package. The `ToolManifest` type, the catalog (an array of manifests), and the pure selectors. No D1, no Hono, no `env`, **no Svelte** — fully unit-testable. `type: module`, `sideEffects: false`, subpath exports. Files:
  - `src/types.ts` — `ToolManifest`, `SubjectGroup`, `ContextTag`, `ToolBacking`.
  - `src/catalog.ts` — the manifest array + the registration discipline (unique ids).
  - `src/select.ts` — `toolsByGroup`, `toolsFor`, the permission filter.
  - Dependencies: `@magna-carta/access-control` (the `Permission` type) only. It references each tool by stable `id` and each integration tool by `category` **string** — never importing a tool's logic package or any UI.
- **The shell (design-system / web app)** — owns the `id → Svelte entry component` map, renders the sidebar group and the contextual entry points, and performs the integration `resolve`/`Dispatch` branching. The actual UI lives here, so it lands with the 0·7a shell.
- **Each tool's logic** stays in its own package (`property-links`, `government-links`, `shipping`). The Tools layer only catalogs them.

Direction: `tools` ← shell; the shell wires manifest `id`s to components and integration `category`s to the registry. `tools` depends on nothing but `access-control`.

## 2. The tool manifest

```ts
export type SubjectGroup =
  | "property"
  | "business-entities"
  | "people-licenses"
  | "mailing-shipping"
  | "printing"
  | "diagnostics"; // connectivity / system / account-health tools — no legal subject (speed test, firm usage/storage, server-connectivity checks, platform uptime)

// What real-world subject a tool can act on — drives contextual surfacing. `none` = general-only.
export type ContextTag = "address" | "person" | "company" | "matter" | "none";

// `library` = no EXTERNAL integration to reflect — covers a pure link generator (property-links), an
// interactive client-side widget (the speed test), AND a view of first-party firm data fetched from
// our own API (firm usage/storage diagnostics). The only distinction the catalog draws is whether a
// tool reflects an external integration's connection health; how a library tool sources its data is a
// UI concern, handled by the shell's id→component map.
export type ToolBacking =
  | { readonly kind: "library" } // pure utility — no connection, no credential
  | { readonly kind: "integration"; readonly category: string }; // reflects the integration registry

// A tool MAY attach its output/cost/audit to a matter. Behaviour is left per-tool and unpinned here —
// the seam exists so the UI can branch when a tool decides it (e.g. shipping may require, an address
// label print may not). Decided when each tool is built.
export type MatterContext = "required" | "optional" | "none";

export interface ToolManifest {
  readonly id: string; // stable, e.g. "attorney-license-lookup"
  readonly name: string; // display label
  readonly icon: string; // Lucide icon name
  readonly subjectGroup: SubjectGroup; // primary grouping in the sidebar
  readonly permission: Permission; // from @magna-carta/access-control — gates BOTH surfaces
  readonly contextTags: readonly ContextTag[]; // ≥1; what the tool accepts
  readonly backing: ToolBacking;
  readonly matterContext: MatterContext; // seam only; default "none"
  // The entry UI is resolved by `id` in the shell — kept out of the manifest so the catalog stays pure.
}
```

`contextTags` is what powers "one capability, two surfaces": the sidebar ignores it; contextual surfaces filter on it. `backing` is what powers the integration tie-in. `permission` gates visibility on both surfaces — a tool the user cannot access is never rendered.

## 3. The two-surface mechanism

**General surface (the sidebar).** The shell reads the catalog, filters by the current user's permissions, groups by `subjectGroup`, and renders. Subject order is fixed (Property · Business & Entities · People & Licenses · Mailing & Shipping · Printing · Diagnostics); within a group, tools render in catalog order.

**Contextual surface.** A domain component calls a selector — `toolsFor("address", permissions)` — which returns the permitted catalog entries whose `contextTags` include that tag. The component renders those as buttons / menu items and hands each tool its context (the address, the person, …). A Location page surfaces every address-tool automatically; a Directory person surfaces every person-tool — adding a new address-tool to the catalog makes it appear on the Location with no change to the Location code. (This generalizes the property-links "buttons ride the Locations UI" intent to **any** address-tool.)

**Integration-backed reflection.** When an `integration` tool renders on either surface, the shell resolves its `category` against the integration registry and branches on the `Dispatch`:

- `ok` → the tool is live; gate individual operations with `requireCapability(resolved, op)` before invoking.
- `not-connected` → render a **"Connect…"** entry point (routes to the connection-management surface — the seam in §6).
- `capability-unsupported` / `adapter-error` → render disabled with an explanatory state.

The Tools layer performs this branching purely as a reader of the framework's existing typed outcomes; it introduces no new connection or credential concept.

## 4. The selectors (pure)

```ts
// Visible groups for a principal, in fixed subject order, each tool permission-filtered.
toolsByGroup(catalog, permissions): { group: SubjectGroup; tools: ToolManifest[] }[]

// Permitted tools accepting a given context — the contextual-surface query.
toolsFor(catalog, tag: ContextTag, permissions): ToolManifest[]
```

Both are total, pure functions over the catalog and the principal's permission set — no I/O. Permission filtering is the same `access-control` resolution the rest of the app uses; the Tools layer adds no access concept of its own.

## 5. Integration boundary (the firm line)

- **library** tools (property-links, government-links, Avery, the speed test, firm usage/storage diagnostics) — no external integration to reflect: a pure link generator, an interactive client-side widget, or a view of first-party firm data fetched from our own API. No port, no credential, no connection record. The catalog references each by `id`; the shell maps `id → component`.
- **integration** tools (shipping, and future connected tools) — the catalog holds only the `category` string. Everything real (port, descriptor, credential, health) lives in `@magna-carta/integrations` and its adapters. The Tools layer never reads or writes a credential.
- **cross-integration diagnostics** (a future connectivity / "verify access" check) are a third relationship: a diagnostics tool that *reads across* the firm's connections — pinging each and reporting the framework's `connected | degraded | needs_reauth | disabled` health — rather than being backed by one integration. It is a read-only consumer of the integration health model, classified `backing: library` (it reflects no single integration's connection) and never connecting, re-authing, or touching credentials — a read-only precursor to, and distinct from, the deferred connection-management UI.

No new credential or connection concept is introduced by Tools. This keeps the framework's own boundary intact: pure utilities stay libraries; only genuinely connected capabilities are integrations.

## 6. Seams left open

- **Matter attachment** — `matterContext` is a manifest seam; per-tool behaviour (require / optional / none) is decided when each tool is built, not here.
- **Connection management** — the integration connection-management UI (connect an account, view health, re-auth, disable) is deferred and unowned in the integration spec. This design assumes a **"Connect…" entry point exists** behind the integration-backed `not-connected` state and routes to that surface; its placement (a dedicated Settings → Integrations area vs. inside Tools) is decided in the integration connection-UI slice.
- **Tool entry UI** — the `id → component` map and the styled sidebar/contextual rendering land with the 0·7a design-system shell.
- **Per-tool build details** — each tool's internals are out of scope here and decided when it is built. Recorded recommendation for the speed test: build the UI on Cloudflare's official `@cloudflare/speedtest` client library and style it with the design system, rather than iframing `speed.cloudflare.com` (a raw external iframe cannot be design-system-styled — golden rule 2).
- **Future Diagnostics tools** (added as catalog rows when built; data sources noted): the **network speed test** (`@cloudflare/speedtest`, above); **firm usage & storage** — a read of the existing slice 1·1 storage metering (exact D1 rollup + scheduled R2-LIST reconciliation) and usage counters, surfaced per firm; **server-connectivity / "verify access"** — the cross-integration health check above, reading the integration framework's connection health; **platform uptime / upkeep** — Magna Carta's own service status and any scheduled-maintenance window. All sit in the Diagnostics subject group.

## 7. Build sequencing

- **Now (no UI dependency):** the pure `@magna-carta/tools` package — types, catalog, selectors — plus manifests for the tools that already exist (property-links, government-links ×3 [property / business / licensing], shipping). Fully testable headless.
- **With slice 0·7a (the shell):** the Tools sidebar destination, the `id → component` map, and the integration `Dispatch` branching.
- **With each domain UI as it lands:** contextual surfacing — Locations (slice 1·1) calls `toolsFor("address")`, Directory (slice 1·3) calls `toolsFor("person" | "company")`. The selector is ready; each domain page only calls it.

## 8. Testing & fitness

- **Catalog unit tests:** every manifest has a name, `subjectGroup`, `permission`, and ≥1 `contextTag`; `id`s are unique; every `integration` manifest names a non-empty `category`.
- **Selector tests:** `toolsFor` returns exactly the permitted, context-matching tools; permission filtering hides what it should; `toolsByGroup` emits groups in fixed order and omits empty groups.
- **Fitness functions:** the `tools` package imports no UI module and no tool-logic package (keeps the catalog pure — the dependency-inversion guard, mirroring the integration framework's no-adapter-in-core scan); every `integration`-backed tool's `category` resolves in the registry at startup.

## 9. Decisions recorded & docs to update

New ADR (Decision Log): **ADR-0097** (the Tools layer — a presentation/IA catalog above the integration framework; the library-vs-integration tool-backing split). Concretizes the white paper's _Plugin / Add-on system_ build-in-vs-plugin rule on the presentation side.

On build: a new slice/cross-cutting row in [`ROADMAP.md`](../../ROADMAP.md) + [`STATUS.md`](../../STATUS.md), and `CHANGELOG.md` — same commit as the work (golden rule 5). User docs (`docs/user/`) begin when the first Tools surface ships (the 0·7a/0·7b precedent). The load-profile accretion rule (ADR-0083) does not bind — the catalog is static code, not per-firm data.
