---
category: Added
---

Docs maintenance automation — fragment assembly now runs on every push to `main` (`.github/workflows/assemble-docs.yml`), so the changelog, Decision-Log register, and STATUS render with each merged PR; the judgment half (coverage audit, drafting, roadmap rollup) ships as the weekly propose-only docs-sync routine (ADR-0058 realized). The roadmap's future source of truth lands with it: the `roadmap.d/` feature ledger — every white-paper capability as a status-carrying node, initially populated by a verified audit of the whole tree. System home `docs/maintenance/`; ledger format `roadmap.d/README.md`; procedure `.claude/skills/docs-sync/`; verified baseline `docs/maintenance/reports/2026-07-14-baseline.md`.
