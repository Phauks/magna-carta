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
active-work:
next: Land the contract stream (folders.list, uploads.get, files.list ingest status); then the Files UI in 0·7.
link-spec:
link-plan:
adrs:
blocked-by:
---

Archives are no longer opaque to a person: browsing one reads its headers over ranged reads and never unpacks a byte, for all four formats the platform recognises - zip, tar, 7z and rar, each decided from the object's own signature rather than its name - and extracting a member (zip, tar, 7z) reads only that member's bytes - or, for a 7z, only the block holding it - and files it through the ordinary ingest gate. Every extraction goes through one module that owns the format dispatch, one refusal vocabulary, the firm's caps and the record of what each attempt cost. Three domain packages + upload/ingest/zip/metering Worker surface + crons; on main. Contract stream (branch file-manager-contract) adds folders.list, uploads.get, and ingest status on files.list/get. UI plan → 0·7. The numbering editor landed on 2026-09-06: Settings · Matter Numbering edits the matter and consultation schemes over the existing routes with a server-rendered preview, and the status window sets a matter's number by hand (only where the matter has been active; the service refuses the unnumbered rungs). The engine became the platform-wide register on 2026-09-18, and on 2026-09-20 the last three fixed runs (invoice, time entry, call and text) became schemes too, so Settings · Numbering is one fold per sequence over all eight and a new sequence is a row on the register rather than a renderer of its own.
