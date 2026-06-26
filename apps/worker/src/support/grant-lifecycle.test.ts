import { describe, expect, it } from "vitest";
import {
  GRANT_WINDOW_SECONDS,
  computeExpiresAt,
  initialGrantStatus,
  supportGrantUsable,
} from "./grant-lifecycle.ts";

describe("grant lifecycle", () => {
  it("requires-cosign starts 'requested', otherwise 'active'", () => {
    expect(initialGrantStatus(true)).toBe("requested");
    expect(initialGrantStatus(false)).toBe("active");
  });

  it("computes expiry from the tier window", () => {
    const now = "2026-06-26T00:00:00.000Z";
    expect(computeExpiresAt("diagnostic", now)).toBe("2026-06-26T02:00:00.000Z");
    expect(computeExpiresAt("privileged", now)).toBe("2026-06-26T01:00:00.000Z");
    expect(GRANT_WINDOW_SECONDS.diagnostic).toBe(7200);
  });

  it("usable only when active and unexpired", () => {
    const now = "2026-06-26T00:30:00.000Z";
    expect(supportGrantUsable({ status: "active", expires_at: "2026-06-26T01:00:00.000Z" }, now)).toBe(true);
    expect(supportGrantUsable({ status: "active", expires_at: "2026-06-26T00:00:00.000Z" }, now)).toBe(false); // expired
    expect(supportGrantUsable({ status: "revoked", expires_at: "2026-06-26T01:00:00.000Z" }, now)).toBe(false);
    expect(supportGrantUsable({ status: "requested", expires_at: "2026-06-26T01:00:00.000Z" }, now)).toBe(false);
  });
});
