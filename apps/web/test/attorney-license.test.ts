/*
 * The Attorney License Lookup's own logic, off the DOM: what the reader is offered, and what a
 * choice resolves to. The tool is a link generator, so "does every state resolve to a live-looking
 * register" is the whole correctness question — there is no request to mock.
 */
import { describe, expect, it } from "vitest";
import {
  licensingStateChoices,
  registerForState,
  registerIsSecure,
} from "../src/lib/tools/attorney-license/attorney-license.ts";

const choices = licensingStateChoices();

describe("the state choices", () => {
  it("offers every state and the District of Columbia", () => {
    expect(choices).toHaveLength(51);
  });

  it("names each state, with its postal code beside it", () => {
    const california = choices.find((choice) => choice.value === "06");
    expect(california?.label).toBe("California");
    expect(california?.aside).toBe("CA");
  });

  it("answers to the postal code as well as the name, because people type either", () => {
    const pennsylvania = choices.find((choice) => choice.label === "Pennsylvania");
    expect(pennsylvania?.keywords).toContain("PA");
  });

  it("carries no duplicate values, so a choice is never ambiguous", () => {
    expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length);
  });
});

describe("resolving a choice to its register", () => {
  it("resolves every offered state to a register on an absolute URL", () => {
    for (const choice of choices) {
      const register = registerForState(choice.value);
      expect(register, choice.label).not.toBeNull();
      expect(register?.searchUrl, choice.label).toMatch(/^https?:\/\//);
      expect(register?.system).toBe("attorneyLicense");
    }
  });

  it("knows which registers are not served over TLS, so the screen can say so", () => {
    // Two of the fifty-one, and not a transcription error: plain-HTTP government portals are
    // ordinary. The screen marks them rather than linking to them silently.
    const insecure = choices
      .map((choice) => ({ choice, register: registerForState(choice.value)! }))
      .filter(({ register }) => !registerIsSecure(register))
      .map(({ choice }) => choice.label);
    expect(insecure).toEqual(["Rhode Island", "Washington"]);
  });

  it("names the register after the state whose register it is", () => {
    expect(registerForState("12")?.name).toBe("Florida Attorney Search");
  });

  it("resolves nothing before a state is chosen", () => {
    expect(registerForState("")).toBeNull();
  });

  it("resolves nothing for a code no state uses", () => {
    // 03 is unassigned in state FIPS, so this is the shape of a stale or hand-edited address.
    expect(registerForState("03")).toBeNull();
  });
});
