---
branch: slice-2-4-conversion
worktree: C:/dev/magna-carta-worktrees/slice-2-4-conversion
area: Slice 2·4a — in-app conversion: substrate-independent core (ConversionPort + registry) + libvips adapter
status: building
touches: packages/conversion, pnpm-workspace.yaml, docs/research/in-app-conversion.md, docs/specs/2026-06-21-slice-2-4a-conversion-core-design.md, docs/specs/2026-06-21-slice-2-4a-conversion-core-implementation-plan.md, docs/decisions/pending/conversion-in-house-only-single-engine.md, docs/active-work/slice-2-4-conversion.md
---

Building the **substrate-independent carve-out** of slice 2·4 (in-app conversion) while the full 2·4
design cycle stays gated on the 2·1/2·2 execution substrate. In scope: the pure **`@magna-carta/conversion`**
package (`ConversionPort`, the format **registry** of single-engine weighted edges, + multi-hop
pathfinding) and the **libvips adapter** over wasm-vips (Node-tested, runtime-agnostic). FFmpeg/Office
edges are registered but their bodies are deferred (typed `engine-not-implemented`). **Conversion is
in-house only, confidentiality absolute, one engine per edge** — the earlier pluggable/egress reframe
was reconsidered and rejected (privileged-content classification is intractable-and-dangerous in a law
practice); recorded as **ADR-conversion-in-house-only-single-engine** (affirms ADR-0030). The
white-paper _In-app file conversion_ amendment was **reverted** to the original in-house guarantee (net
no change vs main). Does **not** touch the in-flight scan-engine (2·1), editing (2·2), or safe-delivery
(2·3) streams, nor the gated execution substrate (orchestrator wiring, Worker routes, Container/
Durable-Object execution, LOK fork-pool, FFmpeg sandbox, save-as-version) — all deferred. Research
base: `docs/research/in-app-conversion.md` (note its superseded-on-the-confidentiality-point banner).
