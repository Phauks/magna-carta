---
category: Changed
audience: public
---

**A crash in the browser now states what was thrown and where.** `crashSignature` in `apps/web/src/lib/diagnostics/crash.ts` gives the kind, the engine's own message for a TypeError, ReferenceError or RangeError (never a message our code or a library wrote, and never a SyntaxError, whose JSON.parse message quotes its input), and the first stack frame. It goes into the breadcrumb ring, onto the failure record as `cause` (a Cause row on the crash screen and a `cause` line in the copied trace), and into the uncaught-error and unhandled-rejection breadcrumbs. A client Error ID had nothing behind it before, because a client crash never reaches a server log.

## Public

**When a page crashes, the error screen now shows a short Cause line beside the Error ID**, so a report says which part of the app failed, not just when.
