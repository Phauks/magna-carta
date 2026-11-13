/*
 * The Soon affordance's wording and its attributes.
 *
 * The rule this defends is that a capability the backend does not serve yet still renders, disabled,
 * saying what it waits on. What goes wrong in practice is not that the rule is forgotten but that
 * every surface obeys it in its own words, so the same missing engine is explained four different
 * ways. One function, one sentence, one test.
 */
import { describe, expect, it } from "vitest";
import {
  soonControlProperties,
  soonDependencySentence,
} from "../src/lib/components/maturity/soon-affordance.ts";

const EM_DASH = "—";

describe("the sentence", () => {
  it("states that the capability is not built, and names what it waits on", () => {
    expect(soonDependencySentence("file conversion")).toBe("Not built yet: file conversion.");
  });

  it("words every dependency identically, so only the dependency differs", () => {
    const first = soonDependencySentence("archive extraction");
    const second = soonDependencySentence("document sharing in the client portal");
    expect(first.replace("archive extraction", "")).toBe(
      second.replace("document sharing in the client portal", ""),
    );
  });

  it("uses no em dash", () => {
    expect(soonDependencySentence("file conversion")).not.toContain(EM_DASH);
  });
});

describe("the attributes handed to the wrapped control", () => {
  it("disables the control rather than leaving it live", () => {
    expect(soonControlProperties("file conversion", "reason-1").disabled).toBe(true);
  });

  it("puts the sentence on the hover", () => {
    expect(soonControlProperties("file conversion", "reason-1").title).toBe(
      soonDependencySentence("file conversion"),
    );
  });

  it("also points at the description, so a disabled control still says why to a reader", () => {
    expect(soonControlProperties("file conversion", "reason-1")["aria-describedby"]).toBe(
      "reason-1",
    );
  });

  it("hands over nothing else, so a call site cannot quietly widen what Soon means", () => {
    expect(Object.keys(soonControlProperties("file conversion", "reason-1")).toSorted()).toEqual([
      "aria-describedby",
      "disabled",
      "title",
    ]);
  });
});
