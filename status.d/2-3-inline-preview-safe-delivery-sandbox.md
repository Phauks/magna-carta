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
next: Point FILES_ORIGIN at a real cookieless host with its zone route, so a playable grant streams in production; then the Preview tab over the streaming path for images and audio.
link-spec:
link-plan:
adrs:
blocked-by:
---

Cookieless `files.*` subresource delivery under a first-party HMAC token; backend on main. The video player is built: the design system's own controls over the browser's video element, at /documents/{fileId}/watch and in the Preview tab. A PORTABLE DOCUMENT does not travel this path at all: the reader at /documents/{fileId}/view rasterizes its pages locally through the pure-Rust engine in a Web Worker, so only pixels reach the page and no rendition engine is needed. The `inline_playable` verdict is judged by the first preview of each version, from bounded ranged reads of the recording's track table, and kept on the row; production streaming still waits on the files host.
