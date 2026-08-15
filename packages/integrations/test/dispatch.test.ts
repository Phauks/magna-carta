import { describe, expect, it } from "vitest";
import {
  adapterError,
  capabilityUnsupported,
  credentialStoreNotImplemented,
  notConnected,
  ok,
} from "../src/dispatch.ts";
import { integrationProblem } from "../src/problem.ts";

describe("Dispatch constructors", () => {
  it("wrap success and the four failure reasons", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(notConnected()).toEqual({ ok: false, reason: "not-connected" });
    expect(capabilityUnsupported()).toEqual({ ok: false, reason: "capability-unsupported" });
    expect(credentialStoreNotImplemented()).toEqual({
      ok: false,
      reason: "credential-store-not-implemented",
    });
    // The unbuilt-seam outcome and the no-connection outcome are never the same value: a caller that
    // compared them would report "connect your account" for a platform nobody can connect one to.
    expect(credentialStoreNotImplemented()).not.toEqual(notConnected());

    const problem = integrationProblem("upstream", 503, "Down");
    expect(adapterError(problem)).toEqual({ ok: false, reason: "adapter-error", problem });
  });
});
