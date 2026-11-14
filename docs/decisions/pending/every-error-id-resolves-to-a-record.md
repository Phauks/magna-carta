---
slug: every-error-id-resolves-to-a-record
status: Accepted
area: Observability
date: 2026-11-14
summary: "Every Error ID a member is shown is kept for thirty days in the control plane's error_record table: the problems the API answers (except 401 and 429) and the browser crashes the app reports. Records hold labels and code names only. A problem reply names its operation and, on a fault, an engine-written cause, and every failure surface leads with a summary of area, action and kind of failure."
---

**Every Error ID a member is shown resolves to a record.** Asked for by the owner on 2026-11-14, after an Error ID on his screen could not be traced.

**Context.** The API minted an Error ID for every problem it answered, but wrote a trace only for an escaped exception, and only to Workers Logs, which nothing in Magna Carta could read without a token the deployment did not have. A refusal's ID (403, 409, 422) was written nowhere. A browser crash's `client_` ID never left the browser. The screen itself showed a generic sentence and the bare ID.

**Decision.**

- The control plane gains `error_record`, keyed by the Error ID. The telemetry middleware writes every problem the API answers, off the request path; a signed-out answer and a rate-limit answer are not kept. The app sends a crash's code-shaped facts to `POST /api/v1/client-errors` when its crash screen draws. Records are deleted after thirty days by the daily pass.
- Every column is a label, a code name or an id: the route template, the problem type and title, the error kind, the scrubbed message head, the first stack frame, the build, the firm and member ids. It lives in the control plane because the platform operator reads it across firms, and a crash before sign-in has no firm.
- A problem reply carries `operation` (the method and route template) and, on a server fault, `cause`: the error kind, with the message only for TypeError, ReferenceError and RangeError, whose messages the engine writes and which name code rather than data.
- Every failure surface leads with a summary line (area, action, kind of failure); Show details opens the facts; Copy details is always present. The owner chose this layout (option B) from three mockups.
- System Status looks an ID up, and Recent Errors reads the table. Workers Logs remains the source only for background failures.

**Consequences.** One control-plane write per answered problem. Validation refusals are the bulk; they are cheap and age out. The error-logging rule that reporting is user-initiated is unchanged: recording a crash's technical facts is a trace, like the server's own, not an incident.
