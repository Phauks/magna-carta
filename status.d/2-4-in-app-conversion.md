---
slice: 2·4 — In-app conversion
group: phase-2
order: 4
research: done by="Opus 4.8"
spec: in-progress by="Opus 4.8"
plan: in-progress by="Opus 4.8"
built: in-progress by="Sonnet 4.6"
ui: n/a
load-profile: n/a
tested: todo
branch: main
active-work:
next: Activate magna-carta-convert (Workers Build project + conversions/ R2 lifecycle rule), then deploy the LibreOffice engine in order (convert worker with the new Container class before the app worker routes the engine id — docs/deploy-queue.md); then the email→PDF render engine on that container's job-package seam, a licensable WordPerfect acceptance fixture, and the matter-attached save-as-version path
link-spec: docs/specs/2026-06-21-slice-2-4a-conversion-core-design.md
link-plan: docs/specs/2026-06-21-slice-2-4a-conversion-core-implementation-plan.md
adrs:
blocked-by:
---

Sub-slices a–e built (core + orchestration + convert worker + pure-Rust raster engine + image→PDF) with per-engine dispatch wired; prod dormant behind the deploy activation. The LibreOffice engine is built too — the four office edges have bodies, a warm worker pool with process-replacement recycling, and an honest readiness probe; its supervisor is host-tested and its image is proved only by the container CI job. Remaining: email/FFmpeg engine bodies, matter-attached save, UI.
