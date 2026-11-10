---
category: Changed
audience: internal
---

**A returning reader's browser no longer re-asks for the application's files.** Cloudflare's asset
server answers every file with `max-age=0, must-revalidate` unless told otherwise, so each repeat
visit to the sign-in page made about 116 conditional requests (a `304` each) before the application
could start. `magna-carta-web` now serves everything under `/_app/immutable/`, whose names carry a
hash of their content, with `Cache-Control: public, max-age=31536000, immutable`. Measured against
`wrangler dev` with Chromium on 2026-11-10: a first visit is unchanged at 120 requests, and a repeat
visit reaches the server once, for the page itself.

**The same change makes a missing application file a `404`.** `magna-carta-web` gains its first
script (`apps/web-worker/src/`), run only for `/_app/*`. The single-page fallback used to answer a
request for a script that was not there with the application shell and a `200`; with a year-long
lifetime that would have let a deploy race store HTML under a script's address. The script answers
`404` with `no-store` instead, and only a response that really is the file gets the lifetime. The
Worker still binds nothing but its own public files. Home: `docs/conventions/operations.md`, the
`magna-carta-web` roster entry.
