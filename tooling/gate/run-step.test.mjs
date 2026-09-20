import { describe, expect, it } from "vitest";
import { runStep, timeoutReport } from "./run-step.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;

/** A sink that behaves like a stream for the runner's purposes and keeps what was written. */
function sink() {
  const written = [];
  return { write: (text) => written.push(text), text: () => written.join("") };
}

const options = (extra = {}) => ({
  root: ROOT,
  environment: process.env,
  out: sink(),
  error: sink(),
  // Never a terminal in a test runner, but stated rather than inferred so the assertion does not
  // change meaning depending on how the suite was started.
  stdinIsTerminal: false,
  ...extra,
});

describe("running a gate step", () => {
  it("passes a step that exits clean", async () => {
    const result = await runStep(
      "probe",
      { name: "true", command: process.execPath, arguments: ["-e", ""] },
      options({ budgetMilliseconds: 30_000 }),
    );
    expect(result.status).toBe("passed");
  });

  it("fails a step that exits non-zero, and says what the step said to say", async () => {
    const error = sink();
    const result = await runStep(
      "probe",
      {
        name: "false",
        command: process.execPath,
        arguments: ["-e", "process.exit(3)"],
        onFailure: "the regenerated file differs",
      },
      options({ budgetMilliseconds: 30_000, error }),
    );
    expect(result.status).toBe("failed");
    expect(error.text()).toContain("the regenerated file differs");
  });

  it("reports a step it could not start as failed rather than hanging on it", async () => {
    const result = await runStep(
      "probe",
      { name: "missing", command: "a-command-that-is-not-installed-anywhere", arguments: [] },
      options({ budgetMilliseconds: 30_000, onWindows: false }),
    );
    expect(result.status).toBe("failed");
  });

  /*
   * The one that matters. A child that will never exit has to come back as its own outcome, and the
   * process has to be GONE afterwards — a timeout that reports a hang while leaving it running has
   * swapped a diagnosable wedge for an undiagnosable one, which is the failure this was built for.
   */
  it("times out a step that never finishes, and leaves nothing of it running", async () => {
    const error = sink();
    const result = await runStep(
      "probe",
      {
        name: "a step that never returns",
        command: process.execPath,
        arguments: ["-e", "setInterval(() => {}, 1000)"],
      },
      options({ budgetMilliseconds: 750, error }),
    );

    expect(result.status).toBe("timed-out");
    expect(result.status).not.toBe("failed");
    expect(error.text()).toContain("TIMED OUT");
    expect(error.text()).toContain("a step that never returns");
  }, 30_000);

  it("kills the step's whole tree, not just the process it was handed", async () => {
    /*
     * The orphan case, which is the one `spawnSync`'s own timeout gets wrong: the gate never holds a
     * handle on the process doing the work. Here a parent spawns a grandchild and then exits its own
     * event loop into a sleep; killing only the parent would leave the grandchild alive.
     */
    const script = `
      const { spawn } = require("node:child_process");
      const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      console.log(grandchild.pid);
      setInterval(() => {}, 1000);
    `;
    const captured = "node_modules/.cache/magna-carta/gate/run-step-tree-probe.txt";
    const result = await runStep(
      "probe",
      {
        name: "a tree that never returns",
        command: process.execPath,
        arguments: ["-e", script],
        outputFile: captured,
      },
      options({ budgetMilliseconds: 1500 }),
    );
    expect(result.status).toBe("timed-out");

    const { readFileSync } = await import("node:fs");
    const grandchildPid = Number(readFileSync(captured, "utf8").trim());
    expect(Number.isInteger(grandchildPid)).toBe(true);

    // Give the reap ladder a moment past its own confirmation, then the grandchild must be gone.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const alive = (() => {
      try {
        process.kill(grandchildPid, 0);
        return true;
      } catch (probeError) {
        return probeError.code === "EPERM";
      }
    })();
    expect(alive).toBe(false);
  }, 30_000);

  it("tells the reader to find the input rather than raise the budget", () => {
    // The message IS the feature. A timeout that only said "timed out" would send the next person
    // looking at their machine, which is the six-day mistake this replaced.
    const report = timeoutReport({
      dimension: "lint",
      step: "vp check --no-fmt (whole repository)",
      budgetMilliseconds: 30 * 60 * 1000,
      teardown: null,
    });
    expect(report).toContain("30 min");
    expect(report).toContain("not a slow machine");
    expect(report).toContain("halve the step's inputs");
    expect(report).toContain("MAGNA_CARTA_GATE_TIMEOUT_SCALE");
  });
});
