/*
 * When the trouble is the platform rather than this panel.
 *
 * The two properties worth pinning are the ones that decide whether the notice is useful or noise:
 * ONE skew is conclusive (the app only calls paths it was built against), and one fault is NOT — a
 * single 503 must not announce an outage, because most 503s are one unlucky read. And a refusal is
 * never evidence about the platform at all: a 403 is the access control working.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Failure, Problem } from "../src/lib/api/problem.ts";
import { platformHealth } from "../src/lib/diagnostics/platform-health.svelte.ts";

function failure(problem: Problem | null): Failure {
  return { problem, request: "GET /matters", failedAt: new Date() };
}

describe("the platform-trouble signal", () => {
  beforeEach(() => platformHealth.reset());

  it("says nothing at rest", () => {
    expect(platformHealth.trouble).toBeNull();
  });

  it("treats one deploy-skew 404 as conclusive", () => {
    platformHealth.note(failure({ status: 404 }));
    expect(platformHealth.trouble).toBe("skew");
  });

  it("does not call one server fault an outage", () => {
    platformHealth.note(failure({ status: 503 }));
    expect(platformHealth.trouble).toBeNull();
  });

  it("calls several faults in a row what they are", () => {
    platformHealth.note(failure({ status: 503 }));
    platformHealth.note(failure(null));
    platformHealth.note(failure({ status: 500 }));
    expect(platformHealth.trouble).toBe("fault");
  });

  it("never counts a refusal — that is the access control working", () => {
    platformHealth.note(failure({ status: 403 }));
    platformHealth.note(failure({ status: 422 }));
    platformHealth.note(failure({ status: 409 }));
    platformHealth.note(failure({ status: 404, type: "t", errorId: "error_x" }));
    expect(platformHealth.trouble).toBeNull();
  });

  it("clears as soon as a read works, rather than waiting the notice out", () => {
    platformHealth.note(failure({ status: 404 }));
    expect(platformHealth.trouble).toBe("skew");
    platformHealth.noteSuccess();
    expect(platformHealth.trouble).toBeNull();
  });
});
