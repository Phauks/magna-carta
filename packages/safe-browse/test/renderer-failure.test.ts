import { describe, expect, it } from "vitest";
import { RendererFailure } from "../src/renderer-failure.ts";

describe("RendererFailure", () => {
  it("treats the service's own momentary faults as transient", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(new RendererFailure(status, null).kind).toBe("transient");
    }
  });

  it("treats a refusal about the caller as a configuration fault", () => {
    // The entitlement, permission and rejected-parameter shapes. None is fixed by waiting, so
    // none may reach the member as the capacity 502.
    for (const status of [400, 401, 403, 404]) {
      expect(new RendererFailure(status, 10000).kind).toBe("configuration");
    }
  });

  it("treats a 422 as the page failing, not the caller and not the service", () => {
    // The service documents 422 as being unable to finish because of an issue with the site. It
    // is the shape a real capture actually met, and reading it as a configuration fault would
    // hand the member an Error ID for a page that is merely slow.
    expect(new RendererFailure(422, 6004).kind).toBe("page");
  });

  it("treats a 2xx carrying success:false as the page failing", () => {
    expect(new RendererFailure(200, 1000).kind).toBe("page");
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
