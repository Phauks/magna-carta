---
slug: the-interface-worker-runs-one-script-to-guard-its-own-files
status: Accepted
area: Delivery
date: 2026-11-10
summary: "magna-carta-web, until now an assets-only Worker with no script, runs one small script for /_app/* only. It gives the content-hashed files under /_app/immutable/ a one-year browser lifetime and answers a missing file under /_app/ with 404 instead of the application shell. The owner chose this on 2026-11-10 over a short lifetime with no script. The Worker still has no binding other than its own public files."
---

**The interface Worker runs one script, for `/_app/*` only, so the application's files can be kept
by browsers for a year without a deploy ever poisoning a cache.**

**Context:** the asset server's default `Cache-Control` is `public, max-age=0, must-revalidate`.
Measured on 2026-11-10, a repeat visit to the sign-in page made 116 conditional requests, one per
file, each answered `304`. The files under `/_app/immutable/` are named by a hash of their content
and can never change, so that revalidation buys nothing. The obvious fix, a `_headers` rule, is
unsafe on this Worker: with `not_found_handling: single-page-application` a request for a file that
does not exist is answered with the application shell and a `200`, and a `_headers` rule applies to
that answer too (verified locally with `wrangler dev`). A browser asking for a chunk while a deploy
is spreading would store HTML under the script's address for a year.

**Decision.** `apps/web-worker` gains `main` and an `ASSETS` binding, with
`run_worker_first: ["/_app/*"]`. For those paths the script asks the asset server and then: answers
`404` with `no-store` when the answer is HTML (nothing under `/_app/` is an HTML document, so HTML
can only be the fallback); sets `public, max-age=31536000, immutable` when the path is under
`/_app/immutable/` and the status is `200`, `206` or `304`; and otherwise returns the answer
untouched. Every other path is still answered by the asset server with no invocation.

**Rejected.** A short lifetime (an hour or a day) in `_headers` with no script: it removes most
repeat requests and bounds the damage of a poisoned entry to that lifetime, but does not remove it,
and still revalidates everything once the lifetime lapses. Leaving the default: correct and slow.

**Consequences.** The earlier rule that this Worker holds no script is replaced by a narrower one
that carries the same security property: it holds no binding but its own public files, and no
secret. A request under `/_app/` is now a Worker invocation, where it was a free static-asset
request; a first visit makes about 116 of them and a repeat visit none. The API Worker's copy of
the build, kept for local development and rollback, has neither the guard nor the lifetime.
