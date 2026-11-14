// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
/*
 * What a server fault's screen may say about its cause, and what a browser crash's record may keep:
 * the engine's own message for the kinds whose message names code, and only the kind otherwise.
 */
import { describe, expect, it } from "vitest";
import { publicCause } from "../src/http/contracts/problem.ts";
import { keptClientMessage } from "../src/http/routes/platform/client-errors.ts";

describe("publicCause", () => {
  it("states the engine's message for the engine's own kinds", () => {
    expect(publicCause("TypeError", "Cannot read properties of undefined (reading 'id')")).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
    expect(publicCause("RangeError", "Invalid time value")).toBe("RangeError: Invalid time value");
  });

  it("states only the kind for a message our code or a library wrote", () => {
    expect(publicCause("Error", "matter Smith v. Jones not found")).toBe("Error");
    expect(publicCause("SyntaxError", 'Unexpected token "x" in JSON')).toBe("SyntaxError");
    expect(publicCause("", "anything")).toBe("Error");
  });

  it("caps a long engine message", () => {
    expect(publicCause("TypeError", "x".repeat(500)).length).toBeLessThanOrEqual(171);
  });
});

describe("keptClientMessage", () => {
  it("keeps an engine kind's message and drops everything else", () => {
    expect(keptClientMessage("TypeError", "x is not a function")).toBe("x is not a function");
    expect(keptClientMessage("Error", "client Jane Doe")).toBeNull();
    expect(keptClientMessage("TypeError", undefined)).toBeNull();
  });
});
