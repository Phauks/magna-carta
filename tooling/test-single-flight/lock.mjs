// A single-flight lock for the test runner: one run per worktree at a time.
//
// Two test runs started in the same worktree contend for the same on-disk state — the Vite transform
// cache, the Miniflare `.wrangler` state each worker suite stands up, and the runner's own worker pool.
// The observed failure is not a crash but a wedge: both processes sit at 0% CPU and neither finishes,
// so the run looks slow rather than broken and the usual response is to wait, then start a third.
// Failing the second run in a hundredth of a second, with the first run's identity in the message, is
// strictly better than a hang nobody can read.
//
// The lock is a file created with the exclusive `wx` flag, which is a single atomic syscall — there is
// no window between "does it exist" and "create it" for a second process to slip through. It holds the
// holder's identity as JSON so the failure message can name what to wait for or kill.
//
// Two ways a lock is reclaimed rather than obeyed, because a lock nobody can clear is worse than no
// lock: the holding process is gone (a run killed with SIGKILL, or a machine that rebooted mid-run),
// or the lock is older than the stale window. Both are checked, so neither a crashed run nor a
// recycled process id can leave a worktree permanently unable to test.

import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync, closeSync } from "node:fs";
import path from "node:path";

/**
 * How long a lock is believed before it is treated as abandoned. Sized well past the slowest full run
 * (the Miniflare worker suites are minutes, not seconds) so a legitimately long run is never stolen
 * from, while an unattended worktree still recovers on its own.
 */
export const STALE_AFTER_MILLISECONDS = 90 * 60 * 1000;

/** Is a process id still running? EPERM means it exists but belongs to someone else — still alive. */
function defaultProcessAlive(processIdentifier) {
  try {
    process.kill(processIdentifier, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readHolder(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    // Truncated or hand-mangled: unreadable identity is not a reason to obey it forever.
    return null;
  }
}

/**
 * Claim the lock, or report who holds it.
 *
 * Returns `{ acquired: true, release }` on success — `release` is idempotent and safe to call from an
 * exit handler. Returns `{ acquired: false, holder, reason }` when another run holds it, where `holder`
 * is whatever identity that run recorded (possibly null, if the file could not be parsed).
 */
export function acquireSingleFlightLock({
  lockPath,
  identity = {},
  now = () => Date.now(),
  staleAfterMilliseconds = STALE_AFTER_MILLISECONDS,
  processAlive = defaultProcessAlive,
} = {}) {
  mkdirSync(path.dirname(lockPath), { recursive: true });

  const write = () => {
    // `wx` fails rather than truncating when the path exists: the atomic claim. The identity is written
    // through that same handle, never by reopening the path — a claimed-but-still-empty file would read
    // to a second process as an abandoned lock, and it would take it.
    const handle = openSync(lockPath, "wx");
    try {
      writeFileSync(handle, JSON.stringify({ ...identity, startedAt: now() }, null, 2));
    } finally {
      closeSync(handle);
    }
    let released = false;
    return {
      acquired: true,
      release() {
        if (released) return;
        released = true;
        rmSync(lockPath, { force: true });
      },
    };
  };

  try {
    return write();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  const holder = readHolder(lockPath);
  const holderGone =
    holder === null ||
    typeof holder.processIdentifier !== "number" ||
    !processAlive(holder.processIdentifier);
  const holderExpired =
    holder === null ||
    typeof holder.startedAt !== "number" ||
    now() - holder.startedAt > staleAfterMilliseconds;

  if (!holderGone && !holderExpired) {
    return { acquired: false, holder, reason: "held" };
  }

  // Abandoned. Clear it and claim once. A second EEXIST here means another process won the same race
  // for the same abandoned lock — it is a live holder now, so report it rather than looping.
  rmSync(lockPath, { force: true });
  try {
    const claimed = write();
    return { ...claimed, reclaimedFrom: holder, reason: holderGone ? "holder-gone" : "expired" };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { acquired: false, holder: readHolder(lockPath), reason: "held" };
  }
}

/** The message a blocked run prints: what is running, since when, and every way out. */
export function blockedMessage(holder, lockPath) {
  const who =
    holder && typeof holder.processIdentifier === "number"
      ? `process ${holder.processIdentifier}`
      : "another process";
  const since =
    holder && typeof holder.startedAt === "number"
      ? ` started ${new Date(holder.startedAt).toISOString()}`
      : "";
  const lines = [
    `A test run is already in flight in this worktree (${who}${since}).`,
    "Two runs in one worktree contend for the same transform cache and Miniflare state and wedge each",
    "other at 0% CPU, so this one is refused rather than joining the pile-up.",
  ];
  if (holder && holder.command) lines.push(`it is running: ${holder.command}`);
  lines.push(
    "wait for that run, or stop it, then run again.",
    `lock file: ${lockPath}`,
    "override (when you have a reason): MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1",
  );
  return lines.join("\n  ");
}
