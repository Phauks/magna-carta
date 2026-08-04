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
active-work: docs/active-work/claude-repo-status-roadmap-xhdvyb.md
next: Activate magna-carta-convert (Workers Build project + conversions/ R2 lifecycle rule); then build the LibreOffice engine to its design (docs/specs/2026-08-04-libreoffice-conversion-engine-design.md), the email→PDF render engine on that container's job-package seam, and the matter-attached save-as-version path
link-spec: docs/specs/2026-06-21-slice-2-4a-conversion-core-design.md
link-plan: docs/specs/2026-06-21-slice-2-4a-conversion-core-implementation-plan.md
adrs:
blocked-by:
---

Sub-slices a–e built (core + orchestration + convert worker + pure-Rust raster engine + image→PDF) with per-engine dispatch wired; prod dormant behind the deploy activation. Remaining: LibreOffice/email/FFmpeg engine bodies (consent-gated), matter-attached save, UI.
