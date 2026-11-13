import { describe, expect, it } from "vitest";
import { crashSignature } from "../src/lib/diagnostics/crash.ts";

describe("crashSignature", () => {
  it("carries the engine's own message and the first frame", () => {
    const error = new TypeError("Cannot read properties of null (reading 'participantId')");
    error.stack = `TypeError: x\n    at Object.get (https://app.example/_app/immutable/chunks/meeting-grid.B1x.js:12:345)`;
    expect(crashSignature(error)).toBe(
      "TypeError: Cannot read properties of null (reading 'participantId') at meeting-grid.B1x.js:12:345",
    );
  });

  it("never carries a message our own code wrote", () => {
    const error = new Error("Smith v. Jones could not be saved");
    error.stack = "Error: Smith\n    at save (https://app.example/a.js:1:2)";
    expect(crashSignature(error)).toBe("Error at a.js:1:2");
  });

  it("never carries a SyntaxError's message, which can quote its input", () => {
    const error = new SyntaxError('Unexpected token S, "Smith v. J" is not valid JSON');
    error.stack = "";
    expect(crashSignature(error)).toBe("SyntaxError");
  });

  it("says what was thrown when it was not an Error", () => {
    expect(crashSignature("boom")).toBe("thrown string");
  });
});
