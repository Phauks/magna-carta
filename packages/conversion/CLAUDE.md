# @magna-carta/conversion — local notes

Pure conversion core (mirrors `@magna-carta/property-links`): a format registry + multi-hop
pathfinding + a `ConversionPort`, plus the libvips image adapter. No D1, no Hono, no `env`, no
network, no UI.

- **In-house only, one engine per edge.** A `ConversionEdge` is `{ from, to, engineId, recipeRef,
weight }`. There is no confidentiality axis, no egress policy, no content classification, and no
  per-edge candidate ranking — every conversion runs in-tenant. (If an external engine is ever
  genuinely needed it is a deliberate future decision; nothing here is built for it.)
- `findPath(from, to)` returns the weighted shortest edge chain (multi-hop, e.g. `wpd→odt→pdf`) or a
  no-path result. `availableConversions(from)` is the reachable target set behind the Convert-to menu.
- An engine implements `ConversionPort.convert` and returns a typed `ConversionResult`, never throws.
  Only **libvips** is implemented (via `wasm-vips`, tested in Node). LibreOffice/FFmpeg/email edges are
  registered but resolve to the shared deferred engine returning `engine-not-implemented` — their
  bodies wait for the gated execution substrate (Container/Durable-Object orchestration, the
  LibreOfficeKit fork-pool, the FFmpeg sandbox).
- libvips runs untrusted bytes: the adapter catches loader failures into `adapter-error` and never
  crashes the process. Production runtime placement (wasm-vips-in-Worker for small images vs native
  libvips in a Container) is deferred; the adapter is runtime-agnostic.

The fitness tests (`test/purity.test.ts`, `test/registry-wellformed.test.ts`) keep the package pure
and the registry consistent.
