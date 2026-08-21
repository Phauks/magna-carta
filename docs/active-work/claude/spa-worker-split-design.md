---
worktree: /home/user/magna-carta
area: delivery — design for splitting the SPA onto its own Worker
status: design
touches: docs/specs, docs/decisions/pending, docs/conventions/operations.md, changelog.d
---

Design only, no product code. The owner asked for the split to be specced after a ten-minute rebuild
for a one-line interface change.

The finding that made it possible is a correction rather than an invention: `apps/web-worker` imports none of
the WebAssembly packages, so the interface build is separable from the three Docker Rust builds. The
deploy runbook had claimed otherwise since 2026-06-28, and that claim is why the question stayed shut.

Two owner flags, `W1` (do the split) and `W2` (what hostname the application answers on). `W2` is a
prerequisite regardless: route patterns do not exist on `workers.dev` and the application is reachable
only there today.

The spec gates itself on a measurement that has not been taken — whether build caching and watch paths
close most of the gap first. If they do, the right outcome is to close the proposal.
