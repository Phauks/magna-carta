// Running one gate step, with a budget it cannot silently exceed.
//
// WHY THIS IS NOT `spawnSync` WITH A `timeout`. Node's synchronous timeout kills the process it was
// handed, and the process the gate is handed is never the one doing the work: under `vp` sits the lint
// or test CLI, and under that the worker threads, the esbuild services and the workerd instances. Kill
// the direct child and the rest are orphaned onto init and keep running — holding the CPU and the
// caches the next step is about to want. That is not theory here. The morning this was written, two
// `vp check` processes from the previous day's killed runs were still resident, and a fresh lint that
// should have taken three seconds sat at 0.1% CPU behind them until they were cleared by hand. A
// timeout that leaves the wedge running has swapped a diagnosable hang for an undiagnosable one.
//
// So the step is spawned to lead its own process group and torn down through the same
// terminate-wait-kill-confirm ladder the test runner's guard uses, which is bounded, reports what it
// escalated to, and does not return until the group is confirmed empty. That module holds the
// reasoning and the measurements: tooling/test-single-flight/process-group.mjs.
//
// A TIMEOUT IS ITS OWN OUTCOME, not a failure. "This check found problems" and "this check never
// finished" call for completely different next moves, and reporting them as one word is the mistake
// that made the original hang cost six days instead of ten minutes.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  reapProcessGroup,
  reapReport,
  shouldLeadOwnProcessGroup,
} from "../test-single-flight/process-group.mjs";
import { describeBudget, SCALE_VARIABLE } from "./budget.mjs";

/** What a timed-out step prints. This is the message the whole mechanism exists to deliver. */
export function timeoutReport({ dimension, step, budgetMilliseconds, teardown }) {
  const lines = [
    `    TIMED OUT after ${describeBudget(budgetMilliseconds)} — "${step}" did not finish and was killed.`,
    "",
    "    A step that does not terminate is not a slow machine, and running it again for longer will",
    "    not finish it either. Something in this dimension's input is one its tool cannot complete on.",
    `    Find it rather than raising the budget: halve the step's inputs, keep the half that hangs, and`,
    "    repeat — it converges in a few rounds even over the whole repository.",
    "",
    `    If this machine really is that slow, ${SCALE_VARIABLE}=2 doubles every budget, and`,
    `    ${SCALE_VARIABLE}=off removes them.`,
  ];
  if (teardown !== null) lines.push("", `    ${teardown}`);
  return lines.join("\n");
}

/**
 * Run one step to completion, to failure, or to its budget.
 *
 * `outputFile` sends the child's output to a regular file and replays it afterwards — for the
 * type-aware lint, whose native printer panics on the EAGAIN a non-blocking pipe can return under a
 * large warning flood. A file cannot return EAGAIN. On a timeout the partial output is replayed too:
 * how far a hanging step got is the first clue to what it choked on.
 *
 * Returns `{ status, seconds }` where status is "passed", "failed" or "timed-out".
 */
export async function runStep(dimension, step, options) {
  const {
    root,
    environment,
    budgetMilliseconds = null,
    onWindows = process.platform === "win32",
    stdinIsTerminal = Boolean(process.stdin.isTTY),
    out = process.stdout,
    error: errorOut = process.stderr,
    sleep: sleepFor = sleep,
  } = options;

  const started = Date.now();
  const elapsed = () => ((Date.now() - started) / 1000).toFixed(0);
  out.write(`--- ${dimension}: ${step.name}\n`);

  let fileDescriptor = null;
  if (step.outputFile !== undefined) {
    mkdirSync(path.dirname(step.outputFile), { recursive: true });
    fileDescriptor = openSync(step.outputFile, "w");
  }
  const replay = () => {
    if (fileDescriptor === null) return;
    closeSync(fileDescriptor);
    fileDescriptor = null;
    try {
      out.write(readFileSync(step.outputFile, "utf8"));
    } catch {
      // The step died before anything reached the file. Nothing to replay is not an error.
    }
  };

  // The same gate the test runner applies, for the same reason: a detached process that reads a
  // controlling terminal takes SIGTTIN and stops. No terminal on stdin, no such read, no hazard.
  const leadsOwnGroup = shouldLeadOwnProcessGroup({
    platform: onWindows ? "win32" : process.platform,
    stdinIsTerminal,
  });

  const child = spawn(step.command, step.arguments, {
    cwd: root,
    stdio: fileDescriptor === null ? "inherit" : ["inherit", fileDescriptor, fileDescriptor],
    env: environment,
    shell: onWindows,
    detached: leadsOwnGroup,
  });

  const finished = new Promise((resolve) => {
    child.once("error", (spawnError) => resolve({ kind: "error", spawnError }));
    child.once("close", (status) => resolve({ kind: "closed", status }));
  });

  let timer = null;
  const budgeted =
    budgetMilliseconds === null
      ? null
      : new Promise((resolve) => {
          timer = setTimeout(() => resolve({ kind: "timeout" }), budgetMilliseconds);
        });

  const outcome = budgeted === null ? await finished : await Promise.race([finished, budgeted]);
  if (timer !== null) clearTimeout(timer);

  if (outcome.kind === "timeout") {
    const teardown = await tearDown({ child, leadsOwnGroup, onWindows, sleepFor });
    replay();
    errorOut.write(
      timeoutReport({
        dimension,
        step: step.name,
        budgetMilliseconds,
        teardown,
      }) + "\n\n",
    );
    return { status: "timed-out", seconds: elapsed() };
  }

  replay();

  if (outcome.kind === "error") {
    errorOut.write(`    could not start ${step.command}: ${outcome.spawnError.message}\n`);
    return { status: "failed", seconds: elapsed() };
  }
  if (outcome.status !== 0) {
    if (step.onFailure !== undefined) errorOut.write(`    ${step.onFailure}\n`);
    errorOut.write(`    FAILED (${elapsed()}s)\n\n`);
    return { status: "failed", seconds: elapsed() };
  }
  out.write(`    ok (${elapsed()}s)\n\n`);
  return { status: "passed", seconds: elapsed() };
}

/** End the step's whole process tree. Returns what had to be escalated to, or null when it went quietly. */
async function tearDown({ child, leadsOwnGroup, onWindows, sleepFor }) {
  if (onWindows) {
    // No process groups to signal; taskkill walks the child tree itself, and its failure (the tree is
    // already gone) is the outcome being asked for anyway.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return null;
  }
  // With `detached`, the child's own pid IS its group id, so the negated pid addresses every
  // descendant. Without it there is no group of ours to address and both degrade to the direct child.
  const signalGroup = (signal) => {
    try {
      if (leadsOwnGroup) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // ESRCH: already gone, which is what was being asked for.
    }
  };
  const groupIsEmpty = () => {
    if (!leadsOwnGroup) return child.exitCode !== null || child.signalCode !== null;
    try {
      process.kill(-child.pid, 0);
      return false;
    } catch (probeError) {
      return probeError.code === "ESRCH";
    }
  };
  const result = await reapProcessGroup({ signalGroup, groupIsEmpty, sleep: sleepFor });
  const report = reapReport(result);
  return report === null ? null : report.replace(/^test: /, "");
}
