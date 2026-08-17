// `pnpm test` — the guarded entry point to the test runner.
//
// This is `vp test` with two things added:
//
//   - a per-worktree single-flight lock, so a second run started while one is in flight fails in
//     milliseconds with a readable message instead of wedging both at 0% CPU (lock.mjs explains the
//     contention);
//   - path-filter resolution, so `pnpm test tooling` selects the tests under `tooling/` instead of
//     reporting that it found none (path-filters.mjs explains why the short spelling misses);
//   - broken-pipe teardown, so `pnpm test | head` ends the run and releases the lock instead of sitting
//     at 0% CPU still holding it (broken-pipe.mjs explains why the parent has to notice, not the child);
//   - process-group teardown, so ending the run ends the RUNNERS rather than only the `vp` process two
//     levels above them, and the lock is released once the group is empty rather than once the direct
//     child has exited (process-group.mjs explains what leaks otherwise, with the measurement).
//
// Options are passed through untouched, and so is any filter that is not a directory in this
// repository, so `pnpm test run packages/ledger` and `pnpm test --watch` behave exactly as the runner
// does.
//
// Prefer `pnpm test` over a bare `vp test`: the bare command is unguarded and is what produces the
// wedge. See docs/conventions/build-performance.md.
//
// MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1 skips the lock entirely — for the deliberate case (two disjoint
// project filters you have reason to believe will not collide), and as the escape hatch if the guard
// itself is ever the thing in the way.

import { spawn, spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  BROKEN_PIPE_EXIT_CODE,
  isBrokenPipe,
  outputMode,
  stdioFor,
  writeIgnoringBrokenPipe,
} from "./broken-pipe.mjs";
import { acquireSingleFlightLock, blockedMessage } from "./lock.mjs";
import { planPathFilters } from "./path-filters.mjs";
import { reapProcessGroup, reapReport, shouldLeadOwnProcessGroup } from "./process-group.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// A vitest project is a directory holding one of these. The root `vite.config.ts` is deliberately not
// one: it REGISTERS the projects (its `test.projects` list) without being one, so counting it would
// make every directory in the repo look reachable.
const PROJECT_CONFIG_PATTERN = /^vitest.*\.config\.ts$/;

const isDirectory = (candidate) => {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

const holdsConfig = (directory) => {
  try {
    return readdirSync(directory).some((entry) => PROJECT_CONFIG_PATTERN.test(entry));
  } catch {
    return false;
  }
};

/** A project config at `directory` or anywhere beneath it. Stops at the first hit. */
function configAtOrBelow(directory) {
  if (holdsConfig(directory)) return true;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (configAtOrBelow(path.join(directory, entry.name))) return true;
  }
  return false;
}

/** A project config in any ancestor of `directory`, up to and including the repository root. */
function configAbove(directory) {
  let current = path.dirname(directory);
  while (current.startsWith(ROOT) && current !== path.dirname(current)) {
    if (holdsConfig(current)) return true;
    if (current === ROOT) break;
    current = path.dirname(current);
  }
  return false;
}

// The filesystem view path-filters.mjs plans against. Filters are resolved against ROOT because that
// is the directory the runner is spawned in below — the two must agree, or a filter would be judged
// against one tree and applied to another.
function inspectFilter(token) {
  const absolutePath = path.resolve(ROOT, token);
  if (!absolutePath.startsWith(ROOT) || !isDirectory(absolutePath)) return undefined;
  return {
    absolutePath,
    holdsProject: configAtOrBelow(absolutePath) || configAbove(absolutePath),
  };
}

// Under node_modules because it is already git-ignored and already per-worktree — which is exactly the
// scope of the contention. A lock shared across worktrees would block runs that never touch each other.
const LOCK_PATH = path.join(
  ROOT,
  "node_modules",
  ".cache",
  "magna-carta",
  "test-single-flight.lock",
);

const requestedArguments = process.argv.slice(2);
const plan = planPathFilters(requestedArguments, inspectFilter);

// Refuse a provably empty selection BEFORE taking the lock — a run that cannot collect a file should
// not hold the lock a real run is waiting for, and it should not exit 0 either. The runner's own exit
// code for an empty selection is already 1; making the refusal explicit here means that stays true
// however the runner's defaults move.
// These messages go out through writeIgnoringBrokenPipe rather than console: they are written before the
// stream error handlers below exist, so an EPIPE here would be an uncaught exception — and the one at
// "reclaimed an abandoned lock" happens with the lock already taken, where a crash would strand it.
if (plan.refusals.length > 0) {
  for (const refusal of plan.refusals)
    writeIgnoringBrokenPipe(process.stderr, `test: ${refusal}\n`);
  process.exit(1);
}
if (plan.resolved.length > 0) {
  writeIgnoringBrokenPipe(
    process.stdout,
    `test: resolved ${plan.resolved.length} directory filter(s) to absolute paths — ` +
      `${plan.resolved.join(", ")} (see tooling/test-single-flight/path-filters.mjs)\n`,
  );
}

const passthroughArguments = plan.arguments;
const skipLock = process.env.MAGNA_CARTA_ALLOW_CONCURRENT_TESTS === "1";

let release = () => {};
if (skipLock) {
  writeIgnoringBrokenPipe(
    process.stdout,
    "test: MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1 — single-flight lock skipped\n",
  );
} else {
  const claim = acquireSingleFlightLock({
    lockPath: LOCK_PATH,
    identity: {
      processIdentifier: process.pid,
      host: hostname(),
      command: ["vp", "test", ...passthroughArguments].join(" "),
    },
  });
  if (!claim.acquired) {
    writeIgnoringBrokenPipe(
      process.stderr,
      "test: " + blockedMessage(claim.holder, LOCK_PATH) + "\n",
    );
    process.exit(1);
  }
  // Assigned BEFORE anything is reported, so no write between the claim and this line can strand a lock
  // whose release still points at the no-op above.
  release = claim.release;
  if (claim.reclaimedFrom !== undefined) {
    writeIgnoringBrokenPipe(
      process.stdout,
      `test: reclaimed an abandoned lock (${claim.reason})\n`,
    );
  }
}

const mode = outputMode(Boolean(process.stdout.isTTY));
// Whether the runner leads its own process group, so teardown can reach every descendant rather than
// only `vp`. process-group.mjs holds the reasoning and the measurement.
const leadsOwnGroup = shouldLeadOwnProcessGroup({
  platform: process.platform,
  stdinIsTerminal: Boolean(process.stdin.isTTY),
});

const child = spawn("vp", ["test", ...passthroughArguments], {
  cwd: ROOT,
  stdio: stdioFor(mode),
  shell: process.platform === "win32",
  detached: leadsOwnGroup,
});

// With `detached`, the child's own pid IS its process group id, so the negated pid addresses the whole
// tree. `kill(pgid, 0)` is the emptiness probe: ESRCH means the last member is gone, EPERM means one is
// alive under another user, and a plain success means alive. When the runner was NOT detached there is
// no group of ours to address — the child shares this process's group — so both degrade to the direct
// child, which is exactly the behaviour this file had before.
const signalRunners = (signal) => {
  try {
    if (leadsOwnGroup) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // ESRCH: already gone, which is the outcome being asked for.
  }
};
const runnersGone = () => {
  if (!leadsOwnGroup) return child.exitCode !== null || child.signalCode !== null;
  try {
    process.kill(-child.pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
};

// The lock must not outlive this process by any exit path — a normal finish, a runner crash, the Ctrl-C
// that ends a watch run, or the reader of a pipe walking away. A lock left behind by a clean exit is the
// fastest way to make the guard look like the bug it exists to prevent.
//
// And it must not be released EARLY either, which is the other half and the one that was missing: a lock
// released while the previous run's vitest, esbuild and workerd processes are still up hands the next run
// a clean claim into a machine that is not clean. So the reap comes first and the release waits on it,
// bounded — a lock held until a wedged runner dies would be the 0%-CPU holder this guard exists to
// eliminate, so a survivor is reported and the lock released regardless.
let finished = false;
const finish = async (code) => {
  if (finished) return;
  finished = true;
  if (process.platform === "win32") {
    // No process groups to signal; taskkill walks the child tree itself. Synchronous, and its failure
    // (the tree is already gone) is the outcome wanted anyway.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    const report = reapReport(
      await reapProcessGroup({ signalGroup: signalRunners, groupIsEmpty: runnersGone, sleep }),
    );
    if (report !== null) writeIgnoringBrokenPipe(process.stderr, report + "\n");
  }
  release();
  process.exit(code);
};

// The reader is gone, so there is nowhere left to report anything: end the run rather than write into a
// closed pipe forever. The SIGTERM-grace-SIGKILL ladder this used to spell out by hand is now `finish`'s
// reap, which runs it against the whole process group instead of the direct child and does not return
// until the group is empty — so this path both ends the run and leaves nothing behind it.
let brokenPipe = false;
const endForBrokenPipe = () => {
  if (finished || brokenPipe) return;
  brokenPipe = true;
  child.stdout?.unpipe(process.stdout);
  child.stderr?.unpipe(process.stderr);
  void finish(BROKEN_PIPE_EXIT_CODE);
};

// Installing an `error` listener is what stops an EPIPE becoming an uncaught exception — which also
// means it is what stops the process dying on its own, so the listener MUST act on it.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => {
    if (isBrokenPipe(error)) endForBrokenPipe();
    else throw error;
  });
}
// POSIX only, and only fires because Node ignores SIGPIPE rather than dying of it. Belt to the braces
// above: on this path the failed write is reported as a signal instead of a stream error.
process.on("SIGPIPE", endForBrokenPipe);

if (mode === "forward") {
  // `{ end: false }` because the child's stdout ending must not close OURS — the guard still has its own
  // exit path to report through. `.pipe()` is what carries backpressure, so nothing is dropped or
  // reordered when the destination is slower than the runner.
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("error", (error) => {
      if (isBrokenPipe(error)) endForBrokenPipe();
    });
  }
}

// `close` rather than `exit`: it fires once the forwarded stdio has drained as well as the process
// having gone, so the last lines of a piped run are not cut off by the `process.exit` below. With
// `stdio: "inherit"` there is no stdio to drain and it follows `exit` immediately.
child.on("close", (code, signal) => {
  if (brokenPipe) return void finish(BROKEN_PIPE_EXIT_CODE);
  return void finish(signal ? 1 : (code ?? 1));
});
child.on("error", (error) => {
  console.error("test: could not start the test runner —", error.message);
  void finish(1);
});
// A detached runner does NOT receive the terminal's Ctrl-C for free — that is the same isolation that
// makes the group addressable — so forwarding here stops being a courtesy and becomes the only way the
// runner hears about it. The signal goes to the whole group so the runner's workers get their chance to
// close cleanly; `finish` then reaps whatever ignored it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    signalRunners(signal);
    // Let the child's own close handler do the release; this is the backstop if it never reports. NOT
    // unref'd: an unref'd backstop lets this process exit while the group is still populated, which is
    // the leak the reap exists to close — the exit handler below would then free the lock with runners
    // still up, and the next run would claim it into a busy machine.
    setTimeout(() => void finish(1), 5000);
  });
}
// Last resort only — a hard crash, or an exit path that never reached `finish`. It cannot reap (exit
// handlers must be synchronous), so it frees the lock without the emptiness guarantee.
process.on("exit", () => release());
