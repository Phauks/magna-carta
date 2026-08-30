/*
 * The two acts a packet never comes back from, and what the screen says about them.
 *
 * These are the highest-consequence assertions on this surface. A release that should have been
 * refused is a client's original handed to the wrong person; a destruction that should have been
 * refused is an irreplaceable document that no longer exists. The server enforces both, and what
 * these cases pin is that the SCREEN never says an act is available when it is not, and never
 * refuses one without saying why.
 */
import { describe, expect, it } from "vitest";
import {
  destructionVerdict,
  holdsInForce,
  refusalSummary,
  releaseVerdict,
} from "../src/lib/custodian/release-gate.ts";
import type { CustodyHold, CustodyItem } from "../src/lib/custodian/custody-api.ts";

function hold(overrides: Partial<CustodyHold> = {}): CustodyHold {
  return {
    id: "custodyHold_one",
    itemId: null,
    kind: "legal",
    placedAt: "2026-02-01T09:00:00.000Z",
    reason: "Estate under challenge",
    releasedAt: null,
    ...overrides,
  };
}

function item(overrides: Partial<CustodyItem> = {}): CustodyItem {
  return {
    id: "custodyItem_one",
    ordinal: 1,
    itemTypeId: null,
    description: "Original will of Jane Smith dated 14 March 2019",
    instrumentDate: "2019-03-14",
    intrinsicValue: false,
    declaredValueAmountMinor: null,
    declaredValueCurrency: null,
    status: "held",
    reviewOn: null,
    reviewIntervalMonths: null,
    ...overrides,
  };
}

describe("holds in force", () => {
  it("counts only holds nobody has released", () => {
    const standing = holdsInForce([
      hold({ id: "custodyHold_open" }),
      hold({ id: "custodyHold_done", releasedAt: "2026-03-01T09:00:00.000Z" }),
    ]);
    expect(standing.map((entry) => entry.id)).toEqual(["custodyHold_open"]);
  });
});

describe("releasing", () => {
  it("is permitted on a held packet with nothing against it", () => {
    expect(releaseVerdict({ status: "held", holds: [] }).permitted).toBe(true);
  });

  it("is refused under a hold, and names the hold and its recorded reason", () => {
    const verdict = releaseVerdict({ status: "held", holds: [hold()] });
    expect(verdict.permitted).toBe(false);
    const [refusal] = verdict.refusals;
    expect(refusal?.reason).toContain("Legal hold");
    expect(refusal?.reason).toContain("Estate under challenge");
  });

  it("says so even when the hold carries no reason", () => {
    // A hold somebody placed without writing down why still forbids the release. Saying nothing
    // would read as a control that is broken rather than one that is refusing.
    const verdict = releaseVerdict({ status: "held", holds: [hold({ reason: null })] });
    expect(verdict.refusals[0]?.reason).toContain("No reason was recorded");
  });

  it("gives every standing hold its own reason", () => {
    const verdict = releaseVerdict({
      status: "held",
      holds: [hold({ id: "custodyHold_one" }), hold({ id: "custodyHold_two", kind: "dispute" })],
    });
    expect(verdict.refusals).toHaveLength(2);
    expect(new Set(verdict.refusals.map((refusal) => refusal.key)).size).toBe(2);
  });

  it("is refused on a record that is already closed", () => {
    for (const status of ["released", "destroyed", "lost"] as const) {
      const verdict = releaseVerdict({ status, holds: [] });
      expect(verdict.permitted).toBe(false);
      expect(verdict.refusals[0]?.reason).toContain("correction");
    }
  });

  it("is permitted on a packet that is out — property comes back before it is handed over", () => {
    expect(releaseVerdict({ status: "out", holds: [] }).permitted).toBe(true);
  });
});

describe("destroying", () => {
  it("is refused outright when any item is an irreplaceable original", () => {
    const verdict = destructionVerdict({
      status: "held",
      holds: [],
      items: [item(), item({ id: "custodyItem_two", intrinsicValue: true })],
    });
    expect(verdict.permitted).toBe(false);
    const stated = verdict.refusals.map((refusal) => refusal.reason).join(" ");
    expect(stated).toContain("irreplaceable original");
    // The refusal has no override anywhere in the register, and the words have to say so: a reader
    // who believes there is a button somewhere will go looking for one.
    expect(stated).toContain("no override");
  });

  it("counts the irreplaceable items rather than naming one of several", () => {
    const verdict = destructionVerdict({
      status: "held",
      holds: [],
      items: [
        item({ id: "custodyItem_one", intrinsicValue: true }),
        item({ id: "custodyItem_two", intrinsicValue: true }),
      ],
    });
    expect(verdict.refusals.some((refusal) => refusal.reason.startsWith("2 items"))).toBe(true);
  });

  it("stacks a hold and an irreplaceable original as two separate reasons", () => {
    const verdict = destructionVerdict({
      status: "held",
      holds: [hold()],
      items: [item({ intrinsicValue: true })],
    });
    expect(verdict.refusals).toHaveLength(2);
  });

  it("is permitted only when nothing at all stands against it", () => {
    expect(destructionVerdict({ status: "held", holds: [], items: [item()] }).permitted).toBe(true);
  });
});

describe("what a disabled control says", () => {
  it("says nothing when the act is available", () => {
    expect(refusalSummary({ refusals: [], permitted: true })).toBeUndefined();
  });

  it("carries the whole reason when there is one", () => {
    const verdict = releaseVerdict({ status: "held", holds: [hold()] });
    expect(refusalSummary(verdict)).toBe(verdict.refusals[0]?.reason);
  });

  it("says how many more there are rather than truncating them out of sight", () => {
    const verdict = destructionVerdict({
      status: "held",
      holds: [hold()],
      items: [item({ intrinsicValue: true })],
    });
    expect(refusalSummary(verdict)).toContain("1 more reason");
  });
});
