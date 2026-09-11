---
slice: 2·3 — Inline preview + safe-delivery sandbox
group: phase-2
order: 3
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8" gap
ui: in-progress
load-profile: n/a
tested: done by="Opus 4.8" gap
branch: main
active-work:
next: The inline_playable writer at ingest, which nothing sets today, then the Preview tab over the streaming path for images and media.
link-spec:
link-plan:
adrs:
blocked-by:
---

Cookieless `files.*` subresource delivery under a first-party HMAC token; backend on main. Player UI → 0·7. A PORTABLE DOCUMENT does not travel this path at all: the reader at /documents/{fileId}/view rasterizes its pages locally through the pure-Rust engine in a Web Worker, so only pixels reach the page and no rendition engine is needed. The streaming path still awaits its `inline_playable` writer, which nothing in the repository sets, so every grant it issues is download-only.
