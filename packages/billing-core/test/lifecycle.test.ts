import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isFrozen,
  type BillableStatus,
} from "../src/lifecycle.ts";
import { IllegalTransitionError } from "../src/lifecycle-error.ts";

const STATUSES: BillableStatus[] = ["draft", "submitted", "approved", "billed", "void"];

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
    expect(() => assertTransition("draft", "approved", true)).toThrow(IllegalTransitionError);
    expect(() => assertTransition("draft", "billed", true)).toThrow(IllegalTransitionError);
    expect(() => assertTransition("submitted", "billed", true)).toThrow(IllegalTransitionError);
  });

  it("the refusal carries the source and target statuses", () => {
    expect(() => assertTransition("draft", "approved", true)).toThrow(
      expect.objectContaining({ from: "draft", to: "approved", gateOn: true }),
    );
  });
});

describe("assertTransition with the review gate OFF", () => {
  it("walks draft -> billed directly (no submit/approve states)", () => {
    expect(() => assertTransition("draft", "billed", false)).not.toThrow();
  });

  it("refuses the gated states when the gate is off", () => {
    expect(() => assertTransition("draft", "submitted", false)).toThrow(IllegalTransitionError);
    expect(() => assertTransition("submitted", "approved", false)).toThrow(IllegalTransitionError);
  });

  it("still allows voiding a draft", () => {
    expect(() => assertTransition("draft", "void", false)).not.toThrow();
  });

  it("allows voiding mid-states even with the gate off", () => {
    expect(() => assertTransition("submitted", "void", false)).not.toThrow();
    expect(() => assertTransition("approved", "void", false)).not.toThrow();
  });
});

describe("frozen states are terminal", () => {
  it("refuses every transition OUT of billed or void, under either gate", () => {
    for (const gateOn of [true, false]) {
      for (const to of STATUSES) {
        expect(() => assertTransition("billed", to, gateOn)).toThrow(IllegalTransitionError);
        expect(() => assertTransition("void", to, gateOn)).toThrow(IllegalTransitionError);
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

  it("reflects gate-off legal transitions", () => {
    expect(canTransition("draft", "billed", false)).toBe(true);
  });
});

describe("gate-off drain for in-flight entries", () => {
  it("allows submitted -> billed when the gate is off (in-flight drain)", () => {
    expect(canTransition("submitted", "billed", false)).toBe(true);
  });

  it("allows approved -> billed when the gate is off (in-flight drain)", () => {
    expect(canTransition("approved", "billed", false)).toBe(true);
  });

  it("billed and void remain terminal under gate-off drain", () => {
    for (const to of STATUSES) {
      expect(canTransition("billed", to, false)).toBe(false);
      expect(canTransition("void", to, false)).toBe(false);
    }
  });

  it("gate-ON table is unchanged — submitted and approved do not reach billed directly under gate-on", () => {
    expect(canTransition("submitted", "billed", true)).toBe(false);
    // approved -> billed remains valid under gate-on (the normal gate-on path)
    expect(canTransition("approved", "billed", true)).toBe(true);
  });
});
