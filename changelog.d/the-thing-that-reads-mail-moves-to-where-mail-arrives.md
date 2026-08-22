---
category: Changed
audience: internal
---

**The email parse engine now runs in `apps/email-worker`, the worker Cloudflare Email Routing
already delivers to, and the app worker calls it over a service binding.**

Three places in `apps/api-worker` initialised the `email-core` WebAssembly build in their own
isolate — the capture consumer, attachment extraction, and the inspector route. All three now go
through a port in `apps/api-worker/src/emails/`, and the engine answers `POST /parse` and
`POST /extract-part?index=N` on a surface that has no public route: `magna-carta-email` declares no
routes and no workers.dev subdomain, so the service binding is the way in and is the trust boundary,
exactly as it is for the scan and recovery workers. `@magna-carta/email-filing/message` re-exports
the parsed-message types so a caller can describe a message without claiming the engine.

**`magna-carta-email` is not connected in Cloudflare, so this ships inert — deliberately, and
visibly.** A service binding to a Worker that does not exist fails the deploy outright, so
`EMAIL_SERVICE` is declared **commented out** in `apps/api-worker/wrangler.jsonc`. Turning email
filing on is two operator steps in order: deploy `magna-carta-email`, then uncomment the binding and
deploy the app worker. Both are written up in the operations runbook.

**The queue caller is why the absent case had to be designed rather than defaulted.** The inspector
route is an ordinary request path and answers a retryable `503` with no Error ID. The capture
consumer runs on a queue, where a throw is a redelivery — and an engine that was never deployed does
not become reachable by being asked again, so treating it as an error would have put every captured
message into a retry storm and dead-lettered a firm's entire mail flow against a condition only a
deployment change can fix. Instead an absent engine is a **terminal, acked outcome that records
why**: an `emails.captureAbandoned` row in the firm's own audit log carrying the job id, the
entrance, the reason, and the staged object's key. Identifiers and enums only, as with every other
row that path writes. The same treatment covers a message the engine read and refused, which is a
fact about the mail. A wedged engine still throws and still retries, because a redelivery genuinely
can fix that.

**Nothing is deleted on the terminal path.** The staged MIME is the only copy of the member's
message, so an abandoned capture leaves it exactly where the entrance put it — which is what makes
the recorded key useful: those captures can be re-enqueued once the binding exists. Mail keeps
arriving and keeps being staged throughout; only the filing waits.

Adding a declared response changes the API contract, so the committed OpenAPI snapshot moves in the
same commit.
