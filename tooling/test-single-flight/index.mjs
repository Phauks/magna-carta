// `pnpm test` — the guarded entry point to the test runner.
//
// This is `vp test` with one thing added: a per-worktree single-flight lock, so a second run started
// while one is in flight fails in milliseconds with a readable message instead of wedging both at 0%
// CPU (lock.mjs explains the contention). Every argument is passed through untouched, so
// `pnpm test run packages/ledger` and `pnpm test --watch` behave exactly as the runner does.
//
// Prefer `pnpm test` over a bare `vp test`: the bare command is unguarded and is what produces the
// wedge. See docs/conventions/build-performance.md.
//
// MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1 skips the lock entirely — for the deliberate case (two disjoint
// project filters you have reason to believe will not collide), and as the escape hatch if the guard
// itself is ever the thing in the way.

import { spawn } from "node:child_process";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireSingleFlightLock, blockedMessage } from "./lock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Under node_modules because it is already git-ignored and already per-worktree — which is exactly the
// scope of the contention. A lock shared across worktrees would block runs that never touch each other.
const LOCK_PATH = path.join(
  ROOT,
  "node_modules",
  ".cache",
  "magna-carta",
  "test-single-flight.lock",
);

const passthroughArguments = process.argv.slice(2);
const skipLock = process.env.MAGNA_CARTA_ALLOW_CONCURRENT_TESTS === "1";

let release = () => {};
if (skipLock) {
  console.log("test: MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1 — single-flight lock skipped");
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
    console.error("test: " + blockedMessage(claim.holder, LOCK_PATH));
    process.exit(1);
  }
  if (claim.reclaimedFrom !== undefined) {
    console.log(`test: reclaimed an abandoned lock (${claim.reason})`);
  }
  release = claim.release;
}

const child = spawn("vp", ["test", ...passthroughArguments], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});

// The lock must not outlive this process by any exit path — a normal finish, a runner crash, or the
// Ctrl-C that ends a watch run. A lock left behind by a clean exit is the fastest way to make the guard
// look like the bug it exists to prevent.
let finished = false;
const finish = (code) => {
  if (finished) return;
  finished = true;
  release();
  process.exit(code);
};

child.on("exit", (code, signal) => finish(signal ? 1 : (code ?? 1)));
child.on("error", (error) => {
  console.error("test: could not start the test runner —", error.message);
  finish(1);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
    // Let the child's own exit handler do the release; this is the backstop if it never reports.
    setTimeout(() => finish(1), 5000).unref();
  });
}
process.on("exit", () => release());
