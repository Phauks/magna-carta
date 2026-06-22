# Slice 2·4a — Conversion Core + libvips Adapter (substrate-independent carve-out) — Design

**Date:** 2026-06-21
**Status:** Designed — implementation plan + build to follow.
**Scope:** The substrate-independent layer of in-app file conversion (slice 2·4), carved out to build
**now**, in parallel with the wait on the 2·1/2·2 execution substrate (Queue + Container +
Durable-Object-per-job). Builds the pure conversion **core** (the `ConversionPort`, capability
descriptors, and the format **registry** with pathfinding + policy-driven selection) and the **libvips
adapter** as the first concrete engine. Research base: [`in-app-conversion.md`](../research/in-app-conversion.md).
**Out of scope (gated on the substrate + the full 2·4 design cycle):** the conversion orchestrator
wiring, Worker routes, Container/Durable-Object execution, the LibreOfficeKit fork-pool, the FFmpeg
sandbox, presigned ingest, and the save-as-version wiring. Those land when the substrate does.

## 1. Why this is buildable now

2·4's gate was on the **execution substrate**, not on the converter's logic. The format registry,
the port contract, and the capability descriptors are **pure** — no Container, no I/O, fully
unit-testable. The libvips adapter is the one concrete engine whose transform logic is self-contained
**and** runs in plain Node.js via **wasm-vips**, so it is testable with golden-file conversions today
with no substrate. This mirrors how the platform built other pure layers ahead of their wiring (the
integration framework, the `@magna-carta/tools` catalog). The production **placement** of libvips
(wasm-vips-in-Worker for tiny images vs native libvips in a Container for the real path) is the only
part that needs the substrate, and the adapter is written runtime-agnostic so placement is a later
swap (see §6).

## 2. The reframe this slice ratifies

2·4's research recorded a change to the published _In-app file conversion_ stance (ADR-0030):
in-house-**only** → **pluggable engines with confidentiality as the default**. The capability
descriptor's `confidentiality` axis encodes that decision, so building the types **is** ratifying it.
This slice therefore lands the decision as **ADR-`conversion-pluggable-engines-confidentiality-default`**
and a surgical amendment to the white paper's _In-app file conversion_. The model: **in-tenant is the
default and the only path for privileged content; external engines (Microsoft 365, Adobe) are a
per-firm opt-in, gated per content-class; egress is a deliberate, governed exception.**

## 3. Package

A new pure package **`@magna-carta/conversion`** (full-name convention; no Worker routes). Layout:

```
packages/conversion/
  src/
    port.ts          ConversionPort interface; ConversionInput/Result; typed errors
    confidentiality.ts   Confidentiality = 'in-tenant' | 'egress'
    descriptor.ts    CapabilityDescriptor (engineId, edges, fidelity, cost, confidentiality)
    format.ts        Format, ConversionEdge, EngineCandidate types
    registry.ts      the platform-defined registry (formats/edges/candidates) + queries
    pathfinding.ts   findPath(source, target): weighted multi-hop shortest path
    policy.ts        FirmEngineEnablement, EgressPolicy, ContentClass
    selection.ts     selectCandidate(edge, firmPolicy); availableConversions(enablement)
    adapters/
      libvips/       wasm-vips ConversionPort implementation
  test/
```

The libvips adapter lives **inside** the package under `adapters/` for now (YAGNI on a separate
package until a second adapter forces the split — the integration-framework precedent).

## 4. The core types (pure)

- **`Confidentiality = 'in-tenant' | 'egress'`** — the posture axis.
- **`Format`** — `{ id, label, mediaType, extensions }`; `id` is a stable format key (e.g. `docx`,
  `pdf`, `png`, `eml`, `mp4`).
- **`ConversionEdge`** — `{ from: FormatId, to: FormatId, candidates: EngineCandidate[] }` (**1..N**
  candidates).
- **`EngineCandidate`** — `{ engineId, recipeRef, fidelity, cost, confidentiality }`.
- **`CapabilityDescriptor`** — `{ engineId, kind: 'in-tenant-container' | 'in-tenant-wasm' |
  'external-credentialed', edges: {from,to}[], confidentiality }` — what an engine/adapter can do; the
  registry is assembled from descriptors.
- **`ConversionPort`** — the execution contract: `convert(input: ConversionInput): Promise<ConversionResult>`,
  where `ConversionInput` carries the source bytes/stream handle, the chosen edge + recipe, and an
  abort signal. The **core never calls this** during pathfinding/selection (those are pure); only an
  adapter implements it. Typed failure result (never throw): `engine-not-implemented` (the deferred
  FFmpeg/Office bodies), `unsupported-edge`, `adapter-error` — mirroring the integration framework's
  typed `Dispatch`.

## 5. Registry + pathfinding + selection (pure, TDD)

- **Registry** — static platform-defined `Format` nodes and `ConversionEdge`s assembled from the
  engines' capability descriptors. Single source of format knowledge; security-sensitive (it drives
  what runs).
- **`findPath(source, target)`** — weighted shortest path over the edge graph, supporting multi-hop
  chains (e.g. `wpd → odt → pdf`); weight by fidelity/cost so the orchestrator prefers fewer,
  higher-fidelity hops. Returns the ordered edge list or `no-path`.
- **`selectCandidate(edge, firmPolicy)`** — policy-driven: prefer the `in-tenant` candidate; choose an
  `egress` candidate **only** when the firm has enabled that engine **and** the content class permits
  egress; **privileged content never selects an `egress` candidate**. Returns the chosen candidate or
  a typed `no-eligible-candidate`.
- **`availableConversions(enablement)`** — the per-firm union of enabled engines' descriptor edges;
  drives the data-driven **Convert to…** menu.
- **Per-firm overlay** — `FirmEngineEnablement` (which engines connected — reuses
  `integration_connection` + the credential store when wired) and `EgressPolicy` (which
  `ContentClass`es may egress; default none). Format knowledge stays platform-wide; only enablement +
  policy are per-firm.

## 6. libvips adapter (the first concrete engine)

- A `ConversionPort` implementation over **wasm-vips** (`kleisauke/wasm-vips`), **tested in Node.js**
  with golden-file conversions (wasm-vips runs in Node 17+). Written **runtime-agnostic** so its
  production placement is a later swap: wasm-vips-in-Worker is viable only for *small* images
  (Workers cap each isolate at 128 MB, cannot thread, WASI is experimental, the `.wasm` is ~4.6 MB —
  there is only an *experimental* `cf-worker-wasm-vips`), so the real/large path will be native
  libvips in a Container when the substrate lands. **This slice does not deploy libvips to a Worker**
  — it builds and proves the adapter.
- **v1 formats:** the common raster set — **PNG / JPEG / WebP / TIFF / GIF** interconversions; **AVIF
  / HEIF** added if the optional `vips-heif`/`vips-jxl` modules are cheap to include.
- **Safe-load posture:** the libvips untrusted-input guard (the `VIPS_BLOCK_UNTRUSTED` equivalent) is
  set; this is the in-tenant, network-free engine, consistent with the cross-cutting untrusted-input
  posture in the research doc.
- **Image → PDF is *not* in v1** — that direction wraps the raster into a PDF via the seamed PDF
  engine (the in-flight Rust engine), so it waits on that seam.

## 7. FFmpeg + Office descriptors registered; bodies deferred

Their capability descriptors + recipe references are registered so the registry, pathfinding, and
selection work **end-to-end** across the whole roster. Their adapter bodies return the typed
`engine-not-implemented` result until the substrate lands (FFmpeg needs the hardened Container
sandbox; Office needs the LOK fork-pool). This proves the core against the real roster shape without
building gated machinery.

## 8. Testing (TDD)

- Pure unit tests: registry assembly, `findPath` (direct, multi-hop, no-path), `selectCandidate`
  (in-tenant preference, egress gating, privileged-never-egress), `availableConversions`.
- libvips adapter: golden-file conversion tests in Node (e.g. PNG→JPEG, JPEG→WebP, round-trip
  dimension/format assertions), plus an untrusted-input refusal test.
- Fitness: a descriptor/registry well-formedness check (every edge's candidates reference a registered
  engine; no `egress` candidate is reachable for a privileged content class by construction).

## 9. Deferred (gated on the substrate + full 2·4 design cycle)

The orchestrator wiring, Worker routes, Container/Durable-Object execution, the LibreOfficeKit
fork-pool, the FFmpeg sandbox build, presigned ingest, save-as-version, and the registry **storage**
decision (static-config vs D1) — all unchanged from the research doc's deferral.

## 10. Open items

- Confirm wasm-vips builds/runs cleanly in the package's Node test runner (Vitest) and pin the version.
- AVIF/HEIF inclusion decision (extra `.wasm` modules) — in or deferred.
- The white-paper amendment wording (coordinated via `vp run worktrees`; surgical, _In-app file
  conversion_ only).
- The `ContentClass` enumeration — minimal at first (e.g. `privileged` vs `general`), expanded with
  the matter/security model in the full design cycle.
