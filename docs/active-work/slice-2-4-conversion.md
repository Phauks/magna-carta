---
branch: slice-2-4-conversion
worktree: C:/dev/magna-carta-worktrees/slice-2-4-conversion
area: Slice 2·4a — in-app conversion: substrate-independent core (ConversionPort + registry) + libvips adapter
status: building
touches: packages/conversion, docs/research/in-app-conversion.md, docs/specs/2026-06-21-slice-2-4a-conversion-core-design.md, docs/decisions/pending/conversion-pluggable-engines-confidentiality-default.md, docs/Magna-Carta-White-Paper.md, docs/active-work/slice-2-4-conversion.md
---

Building the **substrate-independent carve-out** of slice 2·4 (in-app conversion) while the full 2·4
design cycle stays gated on the 2·1/2·2 execution substrate. In scope: the pure **`@magna-carta/conversion`**
package (`ConversionPort`, capability descriptors, the format **registry** + multi-hop pathfinding +
policy-driven selection) and the **libvips adapter** over wasm-vips (Node-tested, runtime-agnostic).
FFmpeg/Office descriptors are registered but their bodies are deferred (typed `engine-not-implemented`).
Lands the confidentiality reframe as **ADR-conversion-pluggable-engines-confidentiality-default** +
a **surgical white-paper amendment** to _In-app file conversion_ (cross-cutting — coordinated via
`vp run worktrees`, no declared overlap; main at 24d0512, no drift). Does **not** touch the in-flight
scan-engine (2·1), editing (2·2), or safe-delivery (2·3) streams, nor the gated execution substrate
(orchestrator wiring, Worker routes, Container/Durable-Object execution, LOK fork-pool, FFmpeg
sandbox, save-as-version) — all deferred. Research base: `docs/research/in-app-conversion.md`.
