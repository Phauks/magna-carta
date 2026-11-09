// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { shouldCutVersion } from "../../src/editing/version-cut-trigger.ts";

describe("version-cut policy", () => {
  it("cuts a version on an explicit Save", () => {
    expect(shouldCutVersion({ type: "save", isAutosave: false })).toBe(true);
  });

  it("does NOT cut on an autosave (it only refreshes the current working object)", () => {
    expect(shouldCutVersion({ type: "save", isAutosave: true })).toBe(false);
  });

  it("cuts a session-close version when the last editor leaves", () => {
    expect(shouldCutVersion({ type: "participant-left", remainingParticipants: 0 })).toBe(true);
  });

  it("does NOT cut when an editor leaves but others remain", () => {
    expect(shouldCutVersion({ type: "participant-left", remainingParticipants: 2 })).toBe(false);
  });

  it("does NOT cut when a co-author joins", () => {
    expect(shouldCutVersion({ type: "participant-joined" })).toBe(false);
  });
});
