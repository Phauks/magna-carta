---
category: Fixed
audience: internal
---

**The shipping credential-store defect was a class, and the class has now been swept: seventeen
injection seams in the worker's composition root, each exercised against `createApp()` with no
overrides. Fifteen are honest or legitimate. One more was not — `POST /api/v1/scan/diagnose`
answered `500 Internal server error` with an Error ID where the scan engine is wired but
unreachable — and it now answers `503`.**

**What a member got.** The route's own description promised "an honest `unscanned` verdict until the
scan Container is activated", and that promise only holds while `SCAN_SERVICE` is **absent**.
`wrangler.jsonc` declares the binding, and Cloudflare refuses a deploy whose service binding names a
worker that does not exist — so the state a deployment actually spends time in is bound-and-answering-5xx
(a placeholder worker, a Container that is not up), where `containerScanAdapter` threw a bare `Error`
and the member asking whether a file was safe was told the platform had broken. The
sibling `POST /api/v1/file-type/verify` degrades to a clean `503` on the identical condition. The
tools reality check recorded the inconsistency on 2026-08-15 and left it, because choosing between
"fault" and "verdict" for an unreachable engine is a safety decision; this changes neither — it
changes only how the fault is **reported** on the one surface that answers a person directly.

**The fix, in the vocabulary that already existed.** A 5xx from the scan service now throws
`ScanFaultError` — the error the verdict layer already raises for a deployed engine reporting
unavailable, because it is the same fact: no scan happened and none can right now. A 4xx keeps the
plain throw, since this adapter and the service disagreeing about the request is fixed by neither a
retry nor a deploy. The diagnostic route catches the typed error and returns the registered
`service-unavailable` problem, whose contract — the condition clears when the binding is activated —
is true here. Nothing about the ingest consumer changed: a queued file with an unreachable engine
still throws, still retries, and still never commits as clean.

**Why nothing caught it.** `apps/worker/vitest.config.ts` registers a stub worker for every service
binding, and the scan stub answers an honest engine-less result over HTTP 200. A stub that behaves
correctly proves only that the route works against a healthy service.
`scan-unreachable-engine-seam.test.ts` binds a placeholder that answers 503 and pins both states
apart: nothing wired at all is still a verdict a firm can read (`unscanned`, reason `no-engine`), an
unreachable engine is a refusal.

**The count, because it is the result.** Of seventeen seams: eleven are legitimate injections with no
production placeholder to test against (the clock, the logger, the fetch and socket adapters, the
browser renderer, the presigner and firm-resource-provider pairs, the flag evaluator, the assistant's
self-marked deterministic inference port, the recovery backend); four were already honest and now
verified by running them (`esign.seal` → `503`, `ai-detection.detect` → `422`,
`tools/turn-credentials` → `503`, the conversion and search engine ports' `engine-not-implemented`);
one was the shipping defect, fixed already; one is this. So the shipping case was closer to unlucky
than typical — but the reason it survived was systemic, and
[`docs/conventions/testing.md`](../docs/conventions/testing.md) now carries the rule: every injection
seam has at least one test that supplies nothing and asserts what a real request gets.

**Not fixed here:** the scan engine's deployment, and the transactional-email adapter, which is the
one remaining seam whose production default is a placeholder — with `EMAIL_FROM` unset the logging
adapter is selected and every verification and reset message is written to a log and dropped while
the API answers success. That is the documented deploy-time activation in the operations runbook, not
a code defect, and it is the seam whose failure no status code can show.
