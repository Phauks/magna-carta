---
branch: slice-2-1-scan-engine
worktree: C:/dev/magna-carta-2-1-dev
area: Slice 2·1 scan tier — SIMD prefilter in front of libclamav
status: building
touches: containers/scan/**, packages/file-manager/src/scan-port.ts (read-only contract), docs/conventions/operations.md, STATUS.md, ROADMAP.md
---

The new slice 2·1 scan tier (supersedes the shelved `slice-2-1-design-and-plans`). Builds on the
existing `containers/scan` crate: validates + commits Option B (spool+mmap transport), then adds a
Vectorscan SIMD literal prefilter in front of clamd so clean files skip libclamav's ~15 MiB/s matcher.
clamd stays the authority (hits + unpack + bytecode); coverage never regresses (differential gate).
Contracts frozen (`MalwareScanPort`, `/scan`, `ScanResult`).

Design: `docs/specs/2026-06-20-scan-engine-design.md`.
Plan: `docs/specs/2026-06-20-slice-2-1-scan-engine-implementation-plan.md`.
Handover/settled analysis: memory `slice-2-1-scan-engine-status.md`.
