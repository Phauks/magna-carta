# Slice 2·4a — Conversion Core + libvips Adapter (substrate-independent carve-out) — Design

**Date:** 2026-06-21
**Status:** Designed — implementation plan + build to follow.
**Scope:** The substrate-independent layer of in-app file conversion (slice 2·4), carved out to build
**now**, in parallel with the wait on the 2·1/2·2 execution substrate (Queue + Container +
Durable-Object-per-job). Builds the pure conversion **core** (the `ConversionPort`, the format
**registry** of single-engine weighted edges, and multi-hop pathfinding) and the **libvips adapter**
as the first concrete engine. Research base: [`in-app-conversion.md`](../research/in-app-conversion.md)
(note its superseded-on-the-confidentiality-point banner).
**Out of scope (gated on the substrate + the full 2·4 design cycle):** the conversion orchestrator
wiring, Worker routes, Container/Durable-Object execution, the LibreOfficeKit fork-pool, the FFmpeg
sandbox, presigned ingest, and the save-as-version wiring. Those land when the substrate does.

## 1. Why this is buildable now

2·4's gate was on the **execution substrate**, not on the converter's logic. The format registry and
the port contract are **pure** — no Container, no I/O, fully unit-testable. The libvips adapter is the
one concrete engine whose transform logic is self-contained **and** runs in plain Node.js via
**wasm-vips**, so it is testable with golden-file conversions today with no substrate. This mirrors how
the platform built other pure layers ahead of their wiring (the integration framework, the
`@magna-carta/tools` catalog). The production **placement** of libvips (wasm-vips-in-Worker for tiny
images vs native libvips in a Container for the real path) is the only part that needs the substrate,
and the adapter is written runtime-agnostic so placement is a later swap (see §6).

## 2. Confidentiality posture — in-house only, absolute

Conversion is **in-house only**: bytes go R2 → our in-tenant Container/WASM → R2 and **never** egress
to a third party. This affirms ADR-0030's guarantee **without exception**. An earlier same-day reframe
toward pluggable external engines (Microsoft 365/Adobe behind an egress policy + per-content-class
classification) was **considered and rejected** — in a law practice nearly all content is privileged,
so any classifier permitting egress is a one-mistake leak of privileged material, and the fidelity
gain is marginal (ADR-`conversion-in-house-only-single-engine`). Consequences for this slice: **no
`confidentiality` axis, no egress policy, no content classification, one engine per edge.** The
`ConversionPort`/adapter seam is retained (good in-house design + a future deliberate seam), but no
external adapter and no policy machinery is built.

## 3. Package

A new pure package **`@magna-carta/conversion`** (full-name convention; no Worker routes). Layout:

```
packages/conversion/
  src/
    port.ts          ConversionPort interface; ConversionInput/Result; typed errors
    format.ts        Format, ConversionEdge ({from, to, engineId, recipeRef, weight}) types
    registry.ts      the platform-defined registry (formats + single-engine weighted edges) + queries
    pathfinding.ts   findPath(source, target): weighted multi-hop shortest path
    adapters/
      libvips/       wasm-vips ConversionPort implementation
  test/
```

The libvips adapter lives **inside** the package under `adapters/` for now (YAGNI on a separate
package until a second adapter forces the split — the integration-framework precedent).

## 4. The core types (pure)

- **`Format`** — `{ id, label, mediaType, extensions }`; `id` is a stable format key (e.g. `docx`,
  `pdf`, `png`, `eml`, `mp4`).
- **`ConversionEdge`** — `{ from: FormatId, to: FormatId, engineId, recipeRef, weight }`. **One engine
  per edge** (no candidate list). `weight` is the pathfinding cost (lower = preferred).
- **`ConversionPort`** — the execution contract: `convert(input: ConversionInput): Promise<ConversionResult>`,
  where `ConversionInput` carries the source bytes/stream handle, the resolved edge + recipe, and an
  abort signal. The **core never calls this** during registry queries/pathfinding (those are pure);
  only an adapter implements it. Typed failure result (never throw): `engine-not-implemented` (the
  deferred FFmpeg/Office bodies), `unsupported-edge`, `adapter-error` — mirroring the integration
  framework's typed `Dispatch`.

## 5. Registry + pathfinding (pure, TDD)

- **Registry** — static platform-defined `Format` nodes and single-engine `ConversionEdge`s, one
  source of format knowledge (security-sensitive: it drives what runs).
- **`findPath(source, target)`** — weighted shortest path over the edge graph, supporting multi-hop
  chains (e.g. `wpd → odt → pdf`); the edge `weight`s let it prefer fewer / higher-fidelity hops.
  Returns the ordered edge list or `no-path`.
- **`resolveEngine(edge)`** — trivial: the edge names its engine. (No candidate selection, no policy —
  the deliberate simplification.)
- **`availableConversions(fromFormat)`** — the set of reachable target formats from a given source
  (a graph reachability query); drives the data-driven **Convert to…** menu. Platform-wide — there is
  no per-firm variation, because there is no per-firm engine enablement.

## 6. libvips adapter (the first concrete engine)

- A `ConversionPort` implementation over **wasm-vips** (`kleisauke/wasm-vips`), **tested in Node.js**
  with golden-file conversions (wasm-vips runs in Node 17+). Written **runtime-agnostic** so its
  production placement is a later swap: wasm-vips-in-Worker is viable only for _small_ images
  (Workers cap each isolate at 128 MB, cannot thread, WASI is experimental, the `.wasm` is ~4.6 MB —
  there is only an _experimental_ `cf-worker-wasm-vips`), so the real/large path will be native
  libvips in a Container when the substrate lands. **This slice does not deploy libvips to a Worker**
  — it builds and proves the adapter.
- **v1 formats:** the common raster set — **PNG / JPEG / WebP / TIFF / GIF** interconversions; **AVIF
  / HEIF** added if the optional `vips-heif`/`vips-jxl` modules are cheap to include.
- **Safe-load posture:** the in-tenant wasm-vips adapter relies on libvips' default hardened loaders
  (wasm-vips exposes no `VIPS_BLOCK_UNTRUSTED` API). The explicit `VIPS_BLOCK_UNTRUSTED` environment
  guard lands with native libvips in the Container (the deferred production placement).
- **Image → PDF is _not_ in v1** — that direction wraps the raster into a PDF via the seamed PDF
  engine (the in-flight Rust engine), so it waits on that seam.

## 7. FFmpeg + Office edges registered; bodies deferred

Their formats + single-engine edges + recipe references are registered so the registry and
pathfinding work **end-to-end** across the whole roster. Their adapter bodies return the typed
`engine-not-implemented` result until the substrate lands (FFmpeg needs the hardened Container
sandbox; Office needs the LibreOfficeKit fork-pool). This proves the core against the real roster
shape without building gated machinery.

## 8. Testing (TDD)

- Pure unit tests: registry assembly, `findPath` (direct, multi-hop, no-path), `resolveEngine`,
  `availableConversions` reachability.
- libvips adapter: golden-file conversion tests in Node (e.g. PNG→JPEG, JPEG→WebP, round-trip
  dimension/format assertions), plus an untrusted-input refusal test.
- Fitness: a registry well-formedness check (every edge names a registered engine; every format an
  edge references is registered; no dangling edges).

## 9. Deferred (gated on the substrate + full 2·4 design cycle)

The orchestrator wiring, Worker routes, Container/Durable-Object execution, the LibreOfficeKit
fork-pool, the FFmpeg sandbox build, presigned ingest, save-as-version, and the registry **storage**
decision (static-config vs D1) — all unchanged from the research doc's deferral.

## 10. Open items

- Confirm wasm-vips builds/runs cleanly in the package's Node test runner (Vitest) and pin the version.
- AVIF/HEIF inclusion decision (extra `.wasm` modules) — in or deferred.
- Edge `weight` calibration — start with hop-count (every edge weight 1); refine only if a multi-hop
  path should be preferred over a lossy direct one.
