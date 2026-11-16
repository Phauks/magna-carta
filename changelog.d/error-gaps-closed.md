---
category: Changed
audience: public
---

**Three gaps in the error record closed.** A 409 offers Retry only for the problem types that say the answer can change (`idempotency-key-conflict`, `export-copies-pending`, `exhibit-set-changed`) or carry no type (`apps/web/src/lib/diagnostics/guidance.ts`). A meeting guest's page keeps its crash at `POST /api/v1/guest/client-errors` on the guest lane's invitation credential, filed under `/join/[token]` with no user. Every `operation.failed` the Workers logger emits in the API Worker is also written to `error_record` with source `background`, through the telemetry package's failed-operation tap (`apps/api-worker/src/system-status/background-error-record.ts`), so Recent Errors shows background failures without `OBSERVABILITY_API_TOKEN`; the token now only adds the other Workers' failures.

## Public

**Fewer dead ends when something fails.** A failure caused by the state a record is in, such as a cost already on a finalized bill, no longer offers a Retry that would only be refused again. A crash on a meeting guest's page is now kept against its reference, so it can be looked up like any other. Failures in scheduled and background work now appear in Recent Errors without any setup.
