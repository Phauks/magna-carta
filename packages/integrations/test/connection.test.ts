import { describe, expect, it } from "vitest";
import { nextHealth } from "../src/connection.ts";

describe("nextHealth", () => {
  it("moves an auth error to needs_reauth and keeps it sticky under transient errors", () => {
    expect(nextHealth("connected", { kind: "error", category: "auth" })).toBe("needs_reauth");
    expect(nextHealth("needs_reauth", { kind: "error", category: "network" })).toBe("needs_reauth");
    expect(nextHealth("needs_reauth", { kind: "circuit-open" })).toBe("needs_reauth");
  });

  it("degrades on transient errors and a circuit open", () => {
    expect(nextHealth("connected", { kind: "error", category: "rate_limit" })).toBe("degraded");
    expect(nextHealth("connected", { kind: "circuit-open" })).toBe("degraded");
  });

  it("clears to connected on success, but disabled is admin-controlled", () => {
    expect(nextHealth("needs_reauth", { kind: "success" })).toBe("connected");
    expect(nextHealth("degraded", { kind: "success" })).toBe("connected");
    expect(nextHealth("connected", { kind: "disable" })).toBe("disabled");
    expect(nextHealth("disabled", { kind: "success" })).toBe("disabled");
    expect(nextHealth("disabled", { kind: "enable" })).toBe("connected");
  });
});
