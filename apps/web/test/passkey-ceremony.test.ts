import { describe, expect, it } from "vitest";
import { passkeyCeremonyScript, passkeyCeremonySteps } from "../src/lib/auth/passkey-ceremony.ts";
import { UNBUILT_CAPABILITIES, unbuiltCapability } from "../src/lib/auth/unbuilt-capabilities.ts";

// WebAuthn is two operations that are not interchangeable, and the failure this pins out is the
// one where a sign-in reports "passkey created": the wrong operation, reported with the wrong
// outcome, because the wording was inferred from the caller instead of read from the mode.
describe("passkeyCeremonyScript", () => {
  it("never lets an authentication claim a credential was created", () => {
    const authenticate = passkeyCeremonyScript("authenticate");
    expect(authenticate.settled).not.toMatch(/creat/i);
    expect(authenticate.failure).not.toMatch(/creat/i);
    expect(authenticate.steps.at(-1)).toBe("Signed in");
  });

  it("never lets a creation claim a session was established", () => {
    const create = passkeyCeremonyScript("create");
    expect(create.settled).not.toMatch(/sign(ed)? in/i);
    expect(create.steps.at(-1)).toBe("Passkey created");
  });

  it("states what did NOT happen, rather than describing a fault", () => {
    // Cancelling is the commonest outcome after a mistaken click, not an error to apologise for.
    expect(passkeyCeremonyScript("create").failure).toContain("No passkey was created");
    expect(passkeyCeremonyScript("authenticate").failure).toContain("You are not signed in");
  });
});

describe("passkeyCeremonySteps", () => {
  it("marks nothing as reached before the native sheet has been asked for", () => {
    expect(passkeyCeremonySteps("create", "idle").every((step) => step.status === "pending")).toBe(
      true,
    );
  });

  it("advances exactly one step at a time", () => {
    expect(passkeyCeremonySteps("create", "asked").map((step) => step.status)).toEqual([
      "active",
      "pending",
      "pending",
    ]);
    expect(passkeyCeremonySteps("create", "exercising").map((step) => step.status)).toEqual([
      "done",
      "active",
      "pending",
    ]);
    expect(passkeyCeremonySteps("create", "settled").map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
    ]);
  });

  it("drops the final step on a cancellation instead of striking it through", () => {
    // The ceremony never reached that moment; showing it struck out claims it did and failed.
    const cancelled = passkeyCeremonySteps("authenticate", "cancelled");
    expect(cancelled).toHaveLength(2);
    expect(cancelled[1]?.status).toBe("failed");
    expect(cancelled[1]?.failure).toBe(passkeyCeremonyScript("authenticate").failure);
  });
});

// The register of what the server cannot do is what keeps a designed-but-unroutable control off
// the live sign-in surface, so it has to stay addressable and self-consistent.
describe("unbuiltCapabilities", () => {
  it("keys every entry uniquely, so a surface can ask about one without matching on prose", () => {
    const ids = UNBUILT_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says what is missing on the SERVER, for every entry", () => {
    for (const capability of UNBUILT_CAPABILITIES) {
      expect(capability.missing.length).toBeGreaterThan(0);
      expect(capability.label.length).toBeGreaterThan(0);
    }
  });

  it("fails loudly on an id that is not registered, rather than rendering an empty gap", () => {
    expect(() => unbuiltCapability("passkey")).not.toThrow();
    expect(() => unbuiltCapability("teleportation")).toThrow(/teleportation/);
  });
});
