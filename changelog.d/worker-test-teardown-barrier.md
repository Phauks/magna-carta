---
category: Fixed
audience: internal
---

Worker test harness — background work is now waited for instead of racing the teardown.

Handlers push work off the response path (`executionCtx.waitUntil`): provisioning, invitation, and
registration-confirmation routes all start a full outbox sweep behind their 201. A test asserting on
the response returns while that sweep is still running, and when the last test in a file returns the
harness tears the environment down underneath it. The sweep is mid-conversation with the test host at
that point — resolving a module on first use, emitting its `outbox.swept` line — so those calls are
closed and reject as `EnvironmentTeardownError: Closing rpc while "resolve" was pending` into a
promise nobody holds. Whether the runner promoted that to a failure depended on how far the sweep
happened to get, so it presented as a flake that unrelated changes appeared to cause or cure.

Fire-and-forget work now goes through `trackBackgroundWork` (`apps/api-worker/src/http/deferred-work.ts`), which
accounts for it, and a global `afterEach` barrier waits for the worker to go quiet after every test.
The barrier reads the worker's own counters, and its test asserts it can still see work being
started — a barrier that quietly stopped observing anything would drain instantly and pass forever.
