import { describe, expect, it } from "vitest";
import { RendererFailure } from "../src/renderer-failure.ts";

describe("RendererFailure", () => {
  it("treats the service's own momentary faults as transient", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(new RendererFailure(status, null).kind).toBe("transient");
    }
  });

  it("treats a refusal about the caller as permanent", () => {
    // The entitlement, permission and rejected-parameter shapes. None is fixed by waiting, so
    // none may reach the member as the capacity 502.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(new RendererFailure(status, 10000).kind).toBe("permanent");
    }
  });

  it("treats a 2xx carrying success:false as permanent", () => {
    expect(new RendererFailure(200, 1000).kind).toBe("permanent");
  });

  it("states the status and code in a message that holds no target", () => {
    const failure = new RendererFailure(401, 10000);
    expect(failure.message).toContain("401");
    expect(failure.message).toContain("10000");
    expect(failure.name).toBe("RendererFailure");
  });

  it("names a missing code rather than printing null", () => {
    expect(new RendererFailure(503, null).message).toContain("none");
  });
});
