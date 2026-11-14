---
category: Changed
audience: public
---

**Every failure says what failed, and every Error ID can be looked up.** Failure bands, failed panels, crash screens and failed-call toasts now lead with one summary line naming the area, the action and the kind of failure, with Show details for the facts and Copy details beside it (the bare Error ID chip is gone). A problem reply carries `operation` (the method and route template) and, on a server fault, `cause` (the error kind, with the engine's own message for TypeError, ReferenceError and RangeError). Every problem the API answers, except 401 and 429, and every browser crash reported through the new `POST /api/v1/client-errors` is kept in the control plane's new `error_record` table for thirty days. System Status gains an Error ID lookup (`GET /api/v1/platform/errors/{errorId}`), and Recent Errors reads the same table, so it no longer waits on the Workers Logs token; that token now only adds background failures.

## Public

**Errors now say what went wrong.** When something fails, the message names the part of Magna Carta, the action and the kind of failure, so the screen alone usually tells you what happened. **Show details** opens the rest, and **Copy details** puts the whole report on your clipboard. Every Error ID is now kept for 30 days, so it can be looked up later.
