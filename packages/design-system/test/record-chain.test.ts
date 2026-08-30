/*
 * RecordChain's rules, which are the parts of it a rendered screenshot would not catch.
 *
 * Two of them matter more than the rest. The chain speaks the status register's words rather than
 * words of its own, so a chip and the chain beneath it can never disagree about what Billed means.
 * And a locked record states its lock ONCE, in one wording, from here rather than from whichever
 * window happened to be built first.
 */
import { describe, expect, it } from "vitest";
import {
  RECORD_CHAIN_STAGES,
  recordChainLockReason,
  recordChainStepState,
} from "../src/lib/components/record-chain/chain-stages.ts";
import { STATUS_REGISTER, type StatusKey } from "../src/lib/status-register/index.ts";

const EM_DASH = "—";

describe("the chain", () => {
  it("runs Draft to Paid, in that order", () => {
    expect(RECORD_CHAIN_STAGES).toEqual(["draft", "submitted", "approved", "billed", "paid"]);
  });

  it("speaks the status register's words, not words of its own", () => {
    for (const stage of RECORD_CHAIN_STAGES) {
      expect(Object.keys(STATUS_REGISTER)).toContain(stage);
      expect(STATUS_REGISTER[stage].label.length).toBeGreaterThan(0);
    }
  });

  it("has no step for a withdrawn record, which has left the chain rather than reached a step", () => {
    expect(RECORD_CHAIN_STAGES).not.toContain("void" as StatusKey);
  });
});

describe("where a record has got to", () => {
  it("marks the reached stage as the present one", () => {
    expect(recordChainStepState("approved", "approved")).toBe("present");
  });

  it("marks everything before it as walked", () => {
    expect(recordChainStepState("draft", "billed")).toBe("past");
    expect(recordChainStepState("submitted", "billed")).toBe("past");
    expect(recordChainStepState("approved", "billed")).toBe("past");
  });

  it("still names what is ahead, rather than hiding it", () => {
    expect(recordChainStepState("paid", "billed")).toBe("future");
    expect(recordChainStepState("billed", "draft")).toBe("future");
  });
});

describe("the lock line", () => {
  it("says nothing about a draft, which is editable outright", () => {
    expect(recordChainLockReason("draft", { hasLinkedObject: false })).toBeNull();
    expect(recordChainLockReason("draft", { hasLinkedObject: true })).toBeNull();
  });

  it("names what would unlock a submitted or approved record", () => {
    for (const stage of ["submitted", "approved"] as const) {
      const reason = recordChainLockReason(stage, { hasLinkedObject: false });
      expect(reason).toContain("draft");
    }
  });

  it("leads into the linked object rather than closing the sentence before it", () => {
    const leading = recordChainLockReason("billed", { hasLinkedObject: true });
    expect(leading).toBe("Billed on");
    expect(leading?.endsWith(".")).toBe(false);
  });

  it("closes the sentence itself where there is no object to hand over", () => {
    const alone = recordChainLockReason("billed", { hasLinkedObject: false });
    expect(alone?.endsWith(".")).toBe(true);
    expect(alone).not.toBe(recordChainLockReason("billed", { hasLinkedObject: true }));
  });

  it("states its fact without lecturing about what the reader may do instead", () => {
    for (const stage of RECORD_CHAIN_STAGES) {
      const reason = recordChainLockReason(stage, { hasLinkedObject: false });
      if (reason === null) continue;
      expect(reason).not.toContain(EM_DASH);
      // A lock is one short statement. Two sentences is the ceiling, and only where the second
      // one says what would unlock it.
      expect(reason.split(". ").length).toBeLessThanOrEqual(2);
    }
  });
});
