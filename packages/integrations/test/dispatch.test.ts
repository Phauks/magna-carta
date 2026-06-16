import { describe, expect, it } from "vitest";
import { adapterError, capabilityUnsupported, notConnected, ok } from "../src/dispatch.ts";
import { integrationProblem } from "../src/problem.ts";

describe("Dispatch constructors", () => {
  it("wrap success and the three failure reasons", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(notConnected()).toEqual({ ok: false, reason: "not-connected" });
    expect(capabilityUnsupported()).toEqual({ ok: false, reason: "capability-unsupported" });

    const problem = integrationProblem("upstream", 503, "Down");
    expect(adapterError(problem)).toEqual({ ok: false, reason: "adapter-error", problem });
  });
});
