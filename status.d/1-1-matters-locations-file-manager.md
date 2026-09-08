---
slice: 1·1 — Matters + Locations + File Manager
group: phase-1
order: 1
research: done
spec: done
plan: in-progress
built: done by="Opus 4.8" gap
ui: in-progress
load-profile: done by="Opus 4.8"
tested: todo
branch: main
active-work: docs/active-work/claude/text-document-editor-support-arvpgv.md
next: Land the contract stream (folders.list, uploads.get, files.list ingest status); then the Files UI in 0·7.
link-spec:
link-plan:
adrs:
blocked-by:
---

Zip archives are no longer opaque to a person: browsing one reads its central directory over ranged reads, and extracting a member reads only that member's bytes and files it through the ordinary ingest gate. Three domain packages + upload/ingest/zip/metering Worker surface + crons; on main. Contract stream (branch file-manager-contract) adds folders.list, uploads.get, and ingest status on files.list/get. UI plan → 0·7. The numbering editor landed on 2026-09-06: Settings · Matter Numbering edits the matter and consultation schemes over the existing routes with a server-rendered preview, and the status window sets a matter's number by hand (only where the matter has been active; the service refuses the unnumbered rungs).
