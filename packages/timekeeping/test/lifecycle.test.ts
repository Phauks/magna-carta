import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isFrozen, type TimeEntryStatus } from "../src/lifecycle.ts";
import { TimeEntryValidationError } from "../src/time-entry-validation.ts";

const STATUSES: TimeEntryStatus[] = ["draft", "submitted", "approved", "billed", "void"];

describe("isFrozen", () => {
  it("is true only for billed and void", () => {
    expect(isFrozen("draft")).toBe(false);
    expect(isFrozen("submitted")).toBe(false);
    expect(isFrozen("approved")).toBe(false);
    expect(isFrozen("billed")).toBe(true);
    expect(isFrozen("void")).toBe(true);
  });
});

describe("assertTransition with the review gate ON", () => {
  it("walks draft -> submitted -> approved -> billed", () => {
    expect(() => assertTransition("draft", "submitted", true)).not.toThrow();
    expect(() => assertTransition("submitted", "approved", true)).not.toThrow();
    expect(() => assertTransition("approved", "billed", true)).not.toThrow();
  });

  it("allows the kick-back submitted -> draft", () => {
    expect(() => assertTransition("submitted", "draft", true)).not.toThrow();
  });

  it("allows voiding from any pre-terminal state", () => {
    expect(() => assertTransition("draft", "void", true)).not.toThrow();
    expect(() => assertTransition("submitted", "void", true)).not.toThrow();
    expect(() => assertTransition("approved", "void", true)).not.toThrow();
  });

  it("refuses skipping the gate (draft -> approved, draft -> billed, submitted -> billed)", () => {
    expect(() => assertTransition("draft", "approved", true)).toThrow(TimeEntryValidationError);
    expect(() => assertTransition("draft", "billed", true)).toThrow(TimeEntryValidationError);
    expect(() => assertTransition("submitted", "billed", true)).toThrow(TimeEntryValidationError);
  });

  it("the refusal carries the illegal-transition code", () => {
    expect(() => assertTransition("draft", "approved", true)).toThrow(
      expect.objectContaining({ code: "illegal-transition" }),
    );
  });
});

describe("assertTransition with the review gate OFF", () => {
  it("walks draft -> billed directly (no submit/approve states)", () => {
    expect(() => assertTransition("draft", "billed", false)).not.toThrow();
  });

  it("refuses the gated states when the gate is off", () => {
    expect(() => assertTransition("draft", "submitted", false)).toThrow(TimeEntryValidationError);
    expect(() => assertTransition("submitted", "approved", false)).toThrow(TimeEntryValidationError);
  });

  it("still allows voiding a draft", () => {
    expect(() => assertTransition("draft", "void", false)).not.toThrow();
  });
});

describe("frozen states are terminal", () => {
  it("refuses every transition OUT of billed or void, under either gate", () => {
    for (const gateOn of [true, false]) {
      for (const to of STATUSES) {
        expect(() => assertTransition("billed", to, gateOn)).toThrow(TimeEntryValidationError);
        expect(() => assertTransition("void", to, gateOn)).toThrow(TimeEntryValidationError);
      }
    }
  });
});

describe("canTransition mirrors assertTransition without throwing", () => {
  it("is true for a legal move and false for an illegal one", () => {
    expect(canTransition("draft", "submitted", true)).toBe(true);
    expect(canTransition("draft", "approved", true)).toBe(false);
    expect(canTransition("billed", "void", true)).toBe(false);
  });
});

it("TimeEntryValidationError carries a stable code", () => {
  expect(new TimeEntryValidationError("frozen-entry", "x").code).toBe("frozen-entry");
});
