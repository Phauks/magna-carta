import { afterEach } from "vitest";
import { backgroundWorkStatus } from "../../src/http/deferred-work.ts";

// The entrypoint reaches the app through a runtime dynamic import (src/index.ts keeps the startup
// budget), and the test pool's module loader deadlocks when that import is first resolved INSIDE a
// request: every SELF.fetch in the suite hung until workerd's watchdog canceled it. Importing the
// module here — while this setup file evaluates, before any test runs — puts it in the loader's
// cache, so the entrypoint's own import() resolves without touching the loader mid-request.
// Production is unaffected either way; only the test pool resolves modules through the host.
import "../../src/event-dispatch.ts";

// The worker deliberately starts work that outlives the response — the request-path outbox sweep is
// the big one — and a test that asserts on the response is finished long before that work is. When
// the last test in a file returns, the harness tears the environment down, and anything the
// background work still has open with the test host is closed underneath it: module resolution on a
// first-use import, and the structured log lines the sweep emits, are both host calls, and both
// reject with `EnvironmentTeardownError: Closing rpc while "<method>" was pending`. Nothing is
// holding those promises, so the rejection surfaces as an uncaught one and fails the run — sometimes.
// Whether it lands is a matter of how far the sweep happened to get, which is why it reads as a
// flake, and why adding work to the bus changes the odds without being the cause.
//
// So the harness waits. This is registered as a global `afterEach` for every worker test file
// (vitest.config.ts `setupFiles`), not opted into per test: any route that provisions, invites, or
// confirms starts a sweep, and a test author has no reason to know that.
//
// Polling rather than awaiting the promises themselves is deliberate. The background work runs in
// the I/O context of the request that started it, which is not the test's; awaiting a promise across
// that boundary is what the runtime refuses ("Cannot perform I/O on behalf of a different request").
// Reading a counter and sleeping on our own timer stays entirely inside the test's context.
const POLL_INTERVAL_MILLISECONDS = 1;

// The runtime abandons a `waitUntil` promise after 30 seconds, so work still in flight past that is
// stuck rather than slow, and waiting longer only trades one hang for another. Failing loud here
// names the test that left it behind.
const SETTLE_TIMEOUT_MILLISECONDS = 30_000;

// Captured while this setup file evaluates, which is before any test file has run and therefore
// before anything can have installed fake timers. The barrier waits on wall-clock time in the real
// world; a test that freezes the clock for its own subject must not also freeze the barrier that
// runs after it, which would hang the file with no timer left to advance it and no deadline left to
// expire.
const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, milliseconds));
}

export async function settleBackgroundWork(): Promise<void> {
  const deadline = realNow() + SETTLE_TIMEOUT_MILLISECONDS;
  // Two consecutive quiet observations, not one: background work can start more background work, and
  // the yield between them also gives an already-issued host call (a log line emitted by the last
  // thing to run) its turn to be answered before the environment can go away.
  let consecutiveQuietObservations = 0;
  while (consecutiveQuietObservations < 2) {
    const { inFlight } = backgroundWorkStatus();
    if (inFlight === 0) consecutiveQuietObservations++;
    else consecutiveQuietObservations = 0;
    if (realNow() > deadline) {
      throw new Error(
        `background work did not settle within ${SETTLE_TIMEOUT_MILLISECONDS}ms: ` +
          `${inFlight} piece(s) still in flight`,
      );
    }
    await sleep(POLL_INTERVAL_MILLISECONDS);
  }
}

afterEach(settleBackgroundWork);
