---
branch: worktree-network-resilience
worktree: C:/dev/magna-carta/.claude/worktrees/network-resilience
area: Cross-cutting — network resilience on constrained connections (new convention + ADR)
status: building
touches: docs/specs/2026-06-29-network-resilience-constrained-networks-design.md, docs/conventions/network-resilience.md (NEW), docs/conventions/README.md (table row), docs/conventions/performance.md (measurement rule), docs/decisions/pending/ (1 ADR fragment), changelog.d/, packages/file-manager (NEW zipEntriesFromR2 helper), apps/worker/src/routes/downloads.ts + apps/worker/src/downloads/bundle-consumer.ts (rewire to the helper)
---

Adds a forward-binding standard for behaving well on slow / metered / high-latency / intermittent
links (prompted by brr.fyi "Engineering for Slow Internet"; stakes are domain-specific — a restarted
download is a missed filing). The standard is a new `docs/conventions/network-resilience.md` plus one
ADR fragment ratifying four commitments: resumable transfer as a required seam (the backend already
realises it), a slow-network harness profile, a shared client transport seam, and a per-route
transfer budget as a fitness function. Most of the standard is **forward seams** — the SPA is a
skeleton, so the transport seam and harness profile are decided-but-deferred with named triggers.

The only **code** change is behaviour-neutral: extract the duplicated R2-entries-to-zip-inputs
generator (`zipInputs` in `routes/downloads.ts`, `inputs` in `downloads/bundle-consumer.ts`) into one
shared `zipEntriesFromR2` helper in `@magna-carta/file-manager`. Tests stay green; no transfer path
is reworked, no threshold is changed.

Cross-cutting edits gated on `vp run worktrees`: `docs/conventions/README.md` (one new table row) and
`docs/conventions/performance.md` (one new measurement pointer). No overlap with the financial-core,
editing, scan, or metadata streams.
