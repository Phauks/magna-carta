---
slice: 2·1 — Inbound upload + untrusted-file pipeline + async bulk download
group: phase-2
order: 1
research: done
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: in-progress
load-profile: done by="Opus 4.8"
tested: todo
branch: main
active-work:
next:
link-spec:
link-plan:
adrs:
blocked-by:
---

Direct-to-R2 ingest + scan pipeline + async bulk download (first DO). Deployed (`magna-carta-scan`, `SCAN_SERVICE`); YARA Forge rules + raw-facts engine + per-firm scan policy + score-histogram seam landed. EICAR live check deferred (no prod users). UI: the matter Upload dialog (intake beside a nested source table), the background upload queue and the top-bar upload tray are built for the single-shot PUT; the resumable multipart client above the mode threshold is not.
