---
category: Changed
audience: internal
---

**One bounded-retry loop draws every sequential number.** `drawWithBoundedRetry` could only give up
as a bare `Error`, and it rethrew immediately whenever an attempt failed without having observed a
draw — so `@magna-carta/matters` and `@magna-carta/custodian` both kept private copies of it and only
the statement builders were actually shared. Two widenings close that. `nonConvergenceError` is now a
required option: the loop composes the "did not converge after N attempts" wording once and hands it
to the caller, which returns the error to throw — custodian a named `CustodyValidationError` its
route maps to a problem type, matters a plain `Error`. A mapper rather than a result type, because
every caller's translation is the same throw and a result type would have pushed that wording back
out into each consumer, and required rather than defaulted so a new sequence has to decide what its
route surfaces. And retryable-ness is now independent of observed-ness: a declared collision that
consumed no counter value is retried without advancing anything, which is the case custodian needs
when a concurrent first use of the shared custody holding matter loses on `matter.system_key` before
the counter is ever read.

Both consumers now run on the shared loop and their copies are gone. Behaviour is unchanged for both:
the give-up messages are composed from the same parts and stay byte-identical, the retryable sets are
the same predicates, and the out-of-band advance uses the same observed value and start value. The
one difference is unreachable and in the safer direction — custodian's private loop inferred "a draw
happened" from `scopeKey !== "" || observed !== 0`, which silently stopped advancing the counter on a
firm-wide scheme whose start value was zero; the explicit signal has no such blind spot.
