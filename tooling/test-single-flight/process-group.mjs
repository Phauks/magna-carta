// Ending a run means ending the RUNNERS, not the one process we happen to hold a handle to.
//
// THE FAILURE THIS PREVENTS. `child.kill()` signals `vp`, and `vp` is not the test runner — it is two
// levels above it. Under `vp` sits the Vitest CLI, and under that the esbuild services and (for the
// worker suites) the workerd instances. Kill the direct child and the rest are orphaned, reparented to
// init, and keep running with the CPU, the Vite transform cache and the Miniflare `.wrangler` state all
// still in hand. Measured on this repository, interrupting `pnpm test apps/worker`: the guard exited
// after 17 s and released the single-flight lock with **nine runner processes still alive**, which
// stayed alive for a further **44 s**.
//
// That is worse than a slow teardown. The next `pnpm test` claims the lock in milliseconds — correctly,
// as far as the lock can tell, because its holder really has gone — and starts against the previous
// run's live runners. The result is exactly the contention the lock exists to prevent, arriving through
// the one door it does not watch, and it presents as timeouts in files neither run touched.
//
// THE FIX, AND WHERE IT APPLIES. The runner is spawned `detached`, so it leads its own process group and
// one signal to the negated group id reaches every descendant however deep. Teardown is then SIGTERM,
// a grace window for the runner to close its workers itself, SIGKILL for whatever is left, and — the
// half that makes the lock honest — the lock is released only once the group is confirmed EMPTY, never
// merely once the direct child has exited.
//
// Detaching is gated on **stdin not being a terminal**, which is the exact shape of the hazard rather
// than a proxy for it. A detached process is in a background process group; if it then READS the
// controlling terminal it takes SIGTTIN and stops, which would wedge `vp test --watch` on its keypress
// reader. No terminal on stdin means no controlling-terminal read is possible and SIGTTIN cannot occur.
// The gate costs nothing where it declines, because an interactive run is in the terminal's FOREGROUND
// process group and Ctrl-C is delivered by the kernel to every process in it — the grandchildren
// included. The hole is precisely where there is no terminal to do that, and that is precisely where
// this detaches. (Known residual gap, named rather than papered over: an interactive terminal where
// only stdout is redirected — `pnpm test | head` typed at a prompt — keeps today's single-child
// teardown, because stdin is still the terminal. Its blast radius is smaller: `head` closing the pipe
// signals nothing to the group, but the run is still in the foreground group, so Ctrl-C reaches it.)
//
// Windows has no process groups to signal, so the tree-kill there is `taskkill /T /F`, which walks the
// child tree itself. That branch is implemented but was NOT measured — the numbers above are POSIX.

/** SIGTERM first, then this long for the runner to close its own workers before SIGKILL. */
export const TERMINATE_GRACE_MILLISECONDS = 2000;
/** After SIGKILL, this long to confirm the group actually emptied before giving up on it. */
export const KILL_CONFIRM_MILLISECONDS = 2000;
/** How often emptiness is re-probed. One `kill(pgid, 0)` syscall, so this can be tight. */
export const POLL_INTERVAL_MILLISECONDS = 50;

/**
 * Should the runner lead its own process group? See the SIGTTIN reasoning above — the answer is "yes
 * whenever nothing can read a controlling terminal", and never on Windows, which has no such concept.
 */
export function shouldLeadOwnProcessGroup({ platform, stdinIsTerminal }) {
  if (platform === "win32") return false;
  return !stdinIsTerminal;
}

/**
 * Signal the group, wait for it to empty, escalate, wait again. Every effect is injected so the
 * escalation ladder can be tested without spawning anything.
 *
 * Returns `{ outcome, waitedMilliseconds }` where outcome is one of:
 *   `already-empty` — nothing outlived the run, the ordinary case and the whole point;
 *   `terminated`    — SIGTERM was enough;
 *   `killed`        — SIGKILL was needed;
 *   `survived`      — something is STILL there. Bounded on purpose: a lock held until a wedged runner
 *                     dies is the 0%-CPU holder this guard was written to eliminate, so the caller
 *                     releases anyway and says so rather than waiting forever.
 */
export async function reapProcessGroup({
  signalGroup,
  groupIsEmpty,
  sleep,
  now = () => Date.now(),
  graceMilliseconds = TERMINATE_GRACE_MILLISECONDS,
  confirmMilliseconds = KILL_CONFIRM_MILLISECONDS,
  pollMilliseconds = POLL_INTERVAL_MILLISECONDS,
}) {
  const started = now();
  const waited = () => now() - started;

  if (groupIsEmpty()) return { outcome: "already-empty", waitedMilliseconds: 0 };

  const waitForEmpty = async (budget) => {
    const deadline = now() + budget;
    while (now() < deadline) {
      await sleep(pollMilliseconds);
      if (groupIsEmpty()) return true;
    }
    return groupIsEmpty();
  };

  signalGroup("SIGTERM");
  if (await waitForEmpty(graceMilliseconds)) {
    return { outcome: "terminated", waitedMilliseconds: waited() };
  }

  signalGroup("SIGKILL");
  if (await waitForEmpty(confirmMilliseconds)) {
    return { outcome: "killed", waitedMilliseconds: waited() };
  }

  return { outcome: "survived", waitedMilliseconds: waited() };
}

/**
 * What the guard prints about a teardown, or null when there is nothing worth saying. Silence is the
 * common case — a run whose runners were already gone should not narrate that — but an escalation and a
 * survivor both change what the next run is walking into, so both are reported.
 */
export function reapReport({ outcome, waitedMilliseconds }) {
  if (outcome === "already-empty" || outcome === "terminated") return null;
  const seconds = (waitedMilliseconds / 1000).toFixed(1);
  if (outcome === "killed") {
    return `test: the runner did not stop on SIGTERM; its process group was killed after ${seconds}s`;
  }
  return (
    `test: WARNING — runner processes survived SIGKILL after ${seconds}s. The single-flight lock is ` +
    "being released anyway, so the next run may contend with them. Check for stray processes before " +
    "believing its results."
  );
}
