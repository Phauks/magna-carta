import { describe, expect, it } from "vitest";
import {
  REVIEW_DOCUMENT_EXCEPTION_CODES,
  REVIEW_DOCUMENT_PROCESSING_STATES,
  REVIEW_SET_FORWARD_TRANSITIONS,
  REVIEW_SET_STATES,
  TERMINAL_PROCESSING_STATES,
  isTerminalProcessingState,
} from "../src/types.ts";
import {
  DiscoveryValidationError,
  assertRecordCustodianName,
  assertReviewSetName,
  assertReviewSetTransition,
  assertWithinDocumentCeiling,
} from "../src/validation.ts";

function codeOf(run: () => void): string {
  try {
    run();
  } catch (caught) {
    if (caught instanceof DiscoveryValidationError) return caught.code;
    throw caught;
  }
  throw new Error("expected a refusal, got none");
}

describe("names", () => {
  it("trims and refuses an empty name on both nouns", () => {
    expect(assertReviewSetName("  Plaintiff's production  ")).toBe("Plaintiff's production");
    expect(codeOf(() => assertReviewSetName("   "))).toBe("discovery-empty-review-set-name");
    expect(assertRecordCustodianName(" J. Smith ")).toBe("J. Smith");
    expect(codeOf(() => assertRecordCustodianName(""))).toBe(
      "discovery-empty-record-custodian-name",
    );
  });
});

describe("the review-set lifecycle", () => {
  it("moves forward only", () => {
    expect(() => assertReviewSetTransition("open", "locked")).not.toThrow();
    expect(() => assertReviewSetTransition("open", "closed")).not.toThrow();
    expect(() => assertReviewSetTransition("locked", "closed")).not.toThrow();
    // Idempotent: asking for the state it is already in is not a move.
    for (const state of REVIEW_SET_STATES) {
      expect(() => assertReviewSetTransition(state, state)).not.toThrow();
    }
  });

  // A REOPEN gets its own code rather than sharing the generic refusal, because it is the request a
  // firm will actually make: the corpus under review is what was reviewed, its derived index has
  // already been released for collection, and a set that could be reopened is a corpus whose
  // contents depend on when you looked at it.
  it("refuses a reopen by its own name and explains itself", () => {
    expect(codeOf(() => assertReviewSetTransition("closed", "open"))).toBe(
      "discovery-review-set-reopen-refused",
    );
    expect(codeOf(() => assertReviewSetTransition("closed", "locked"))).toBe(
      "discovery-review-set-reopen-refused",
    );
    expect(codeOf(() => assertReviewSetTransition("locked", "open"))).toBe(
      "discovery-review-set-transition-refused",
    );
  });

  it("has no transition table entry that walks backwards", () => {
    const order = ["open", "locked", "closed"] as const;
    for (const [from, allowed] of Object.entries(REVIEW_SET_FORWARD_TRANSITIONS)) {
      const fromIndex = order.indexOf(from as (typeof order)[number]);
      for (const to of allowed) {
        expect(order.indexOf(to)).toBeGreaterThan(fromIndex);
      }
    }
    expect(REVIEW_SET_FORWARD_TRANSITIONS.closed).toEqual([]);
  });
});

describe("the document ceiling", () => {
  it("admits a load that fits exactly", () => {
    expect(() =>
      assertWithinDocumentCeiling({
        currentDocumentCount: 249_000,
        incomingDocumentCount: 1_000,
        documentCeiling: 250_000,
      }),
    ).not.toThrow();
  });

  // REFUSED, never degraded, and the refusal carries BOTH numbers: a firm told only "too many" has
  // to guess how much of the load to split off.
  it("refuses past the ceiling with the count and the ceiling in the message", () => {
    let message = "";
    try {
      assertWithinDocumentCeiling({
        currentDocumentCount: 249_000,
        incomingDocumentCount: 5_000,
        documentCeiling: 250_000,
      });
    } catch (caught) {
      message = (caught as DiscoveryValidationError).message;
    }
    expect(
      codeOf(() =>
        assertWithinDocumentCeiling({
          currentDocumentCount: 249_000,
          incomingDocumentCount: 5_000,
          documentCeiling: 250_000,
        }),
      ),
    ).toBe("discovery-document-ceiling-exceeded");
    expect(message).toContain("254000");
    expect(message).toContain("250000");
    expect(message).toContain("249000");
  });
});

describe("the two terminal states", () => {
  // There is no third, and that is the rule the exception report rests on: a document that ends in
  // neither has fallen out of the corpus with nobody able to tell.
  it("has exactly two, and they are processed and excepted", () => {
    expect([...TERMINAL_PROCESSING_STATES]).toEqual(["processed", "excepted"]);
    expect(REVIEW_DOCUMENT_PROCESSING_STATES.filter(isTerminalProcessingState)).toEqual([
      "processed",
      "excepted",
    ]);
    expect(isTerminalProcessingState("pending")).toBe(false);
    expect(isTerminalProcessingState("processing")).toBe(false);
  });

  // "extraction failed" is deliberately not on the list: a firm hands the exception report to
  // opposing counsel, and every code on it is a different conversation with a court.
  it("names every non-success rather than shrugging", () => {
    expect(REVIEW_DOCUMENT_EXCEPTION_CODES).toHaveLength(15);
    expect(new Set(REVIEW_DOCUMENT_EXCEPTION_CODES).size).toBe(
      REVIEW_DOCUMENT_EXCEPTION_CODES.length,
    );
    for (const code of REVIEW_DOCUMENT_EXCEPTION_CODES) {
      expect(code).not.toBe("failed");
      expect(code).not.toBe("error");
      expect(code).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  });
});
