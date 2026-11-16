import { describe, expect, it } from "vitest";
import { NECESSITY_MARKING, necessityMark } from "../src/lib/components/label/necessity.ts";

describe("the mark a label draws for whether its field must be filled", () => {
  it("marks only the optional side when optional fields carry the mark", () => {
    expect(necessityMark("optional", "mark-optional")).toEqual({
      text: "Optional",
      decorative: false,
    });
    expect(necessityMark("required", "mark-optional")).toBeNull();
  });

  it("marks only the required side, as decoration, when required fields carry the mark", () => {
    expect(necessityMark("required", "mark-required")).toEqual({ text: "*", decorative: true });
    expect(necessityMark("optional", "mark-required")).toBeNull();
  });

  it("draws nothing for a field that is neither, under either setting", () => {
    expect(necessityMark(undefined, "mark-optional")).toBeNull();
    expect(necessityMark(undefined, "mark-required")).toBeNull();
  });

  it("is one setting for the whole product", () => {
    expect(["mark-optional", "mark-required"]).toContain(NECESSITY_MARKING);
  });
});
