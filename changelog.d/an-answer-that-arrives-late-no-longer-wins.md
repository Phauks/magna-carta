---
category: Fixed
audience: public
---

**Browser-side race safety, plus the Durable Object gate and two property verifiers.** `LatestOnly` (`apps/web/src/lib/api/latest-only.ts`) replaces five hand-rolled stale-answer counters; `pnpm run lint:stale-response` fails a sixth and is what found the fifth. `WriteIntent` holds one idempotency key across every attempt at one intent, so a retry after an ambiguous failure replays rather than duplicating — the double-click that `writeKey`'s comment claimed to cover is already handled by any synchronously-set in-flight flag; the comment is corrected in all four modules. `pnpm run lint:durable-object-gates` scans for a Durable Object deciding across a non-storage await and found `BundleBuildCoordinator.requestBundle` HEADing R2 mid-decision, so two requests for one expired bundle each enqueued a full rebuild; fixed with `blockConcurrencyWhile`. Property verifiers for the number draw (correctness absolute at every N; convergence bounded at five by the retry budget, now pinned) and for concurrent ledger postings against the domain's own fitness queries.

## Public

A screen no longer shows the wrong matter's information when you move between records quickly — an answer that arrives after you have moved on is discarded instead of being displayed under the record you are now looking at. Retrying a save that failed without a clear answer no longer risks recording it twice. And asking twice for the same large download now builds it once rather than starting a second copy.
