/*
 * The status window's model, pinned. Three things are worth a test here, and all three are things a
 * person reads immediately before a matter's standing changes:
 *
 *   - every status offers exactly one step, and it is the step the contract actually serves;
 *   - a refused close keeps the subsystems' own reasons, which name what clears them;
 *   - what is in the way of taking a step is said as the specific thing it is, never as a blanket
 *     "unavailable" — a sample matter, a missing permission and a session still being read are
 *     three different facts and a person can act on exactly one of them.
 */
import { describe, expect, it } from "vitest";
import {
  matterCloseChecklist,
  matterCloseConsiderations,
  matterCloseRefusals,
  matterLifecycleBlock,
  matterLifecycleStep,
  CLOSE_REFUSED_PROBLEM_TYPE,
  MATTER_CLOSE_REQUIREMENTS,
  MATTER_LIFECYCLE_STEPS,
} from "../src/lib/matters/matter-lifecycle.ts";
import { matterSections } from "../src/lib/matters/sections.ts";
import { MATTER_STATUSES } from "../src/lib/matters/matter-status.ts";

describe("matterLifecycleStep", () => {
  it("offers one step per status, in the direction the lifecycle runs", () => {
    expect(matterLifecycleStep("prospective").action).toBe("open");
    expect(matterLifecycleStep("open").action).toBe("close");
    expect(matterLifecycleStep("closed").action).toBe("reopen");
  });

  it("covers every status the contract stores", () => {
    for (const status of MATTER_STATUSES) {
      expect(matterLifecycleStep(status).label).not.toBe("");
    }
  });

  it("says what closing does without overstating it", () => {
    const close = MATTER_LIFECYCLE_STEPS.open;
    // Closing changes a standing and stamps a date. It is not a deletion, and the sentence a reader
    // is most likely to get wrong on their own is the one that has to be there.
    expect(close.consequences.join(" ")).toContain("still takes entries");
    expect(close.consequences.join(" ")).toContain("close date");
  });

  it("names the permission each endpoint enforces", () => {
    expect(MATTER_LIFECYCLE_STEPS.prospective.permission).toBe("matters:open");
    expect(MATTER_LIFECYCLE_STEPS.open.permission).toBe("matters:close");
    expect(MATTER_LIFECYCLE_STEPS.closed.permission).toBe("matters:reopen");
  });
});

describe("matterCloseRefusals", () => {
  it("keeps one reason per rule that refused, in the words the rule wrote", () => {
    const refusals = matterCloseRefusals({
      status: 409,
      type: CLOSE_REFUSED_PROBLEM_TYPE,
      detail: "One or more close preconditions refused this matter.",
      errors: [
        {
          path: "$",
          code: "trust-balance-not-zero",
          detail: "this matter still holds $1,250.00 on the IOLTA trust ledger.",
        },
        {
          path: "$",
          code: "client-credit-open",
          detail: "this matter carries $80.00 the firm owes back to the client.",
        },
      ],
    });
    expect(refusals).toHaveLength(2);
    expect(refusals[0]?.code).toBe("trust-balance-not-zero");
    // Only the leading character is the surface's: the amounts and the ledger name are the server's.
    expect(refusals[0]?.reason).toBe(
      "This matter still holds $1,250.00 on the IOLTA trust ledger.",
    );
    expect(refusals[1]?.reason).toBe(
      "This matter carries $80.00 the firm owes back to the client.",
    );
  });

  it("reads nothing from a 409 that is not a refusal", () => {
    // An idempotency key still in flight is also a 409, and there is nothing a person does about it.
    expect(
      matterCloseRefusals({
        status: 409,
        type: "idempotency-key-in-progress",
        detail: "A request with this Idempotency-Key is still in progress.",
      }),
    ).toEqual([]);
  });

  it("drops an entry that carries no words rather than rendering an empty row", () => {
    expect(
      matterCloseRefusals({
        status: 409,
        type: CLOSE_REFUSED_PROBLEM_TYPE,
        errors: [{ code: "trust-balance-not-zero" }, { code: "x", detail: "" }],
      }),
    ).toEqual([]);
  });
});

describe("matterLifecycleBlock", () => {
  const step = MATTER_LIFECYCLE_STEPS.open;

  it("lets a firm matter through once the session says the account may take the step", () => {
    expect(
      matterLifecycleBlock({
        step,
        isSample: false,
        sessionSettled: true,
        permissions: ["matters:close"],
      }),
    ).toBeNull();
  });

  it("says a sample matter is a sample, and says it before anything else is read", () => {
    const block = matterLifecycleBlock({
      step,
      isSample: true,
      sessionSettled: false,
      permissions: null,
    });
    expect(block).toContain("sample matter");
  });

  it("names the permission the account is missing", () => {
    expect(
      matterLifecycleBlock({ step, isSample: false, sessionSettled: true, permissions: [] }),
    ).toContain("matters:close");
  });

  it("waits while the session is being read", () => {
    expect(
      matterLifecycleBlock({ step, isSample: false, sessionSettled: false, permissions: null }),
    ).toBe("Reading your session.");
  });

  it("does not refuse the step when the session read itself failed", () => {
    // Unknown is not unprivileged. Blocking here would refuse somebody who holds the permission on
    // the strength of a failed read; the server checks the same permission and answers in its own
    // words.
    expect(
      matterLifecycleBlock({ step, isSample: false, sessionSettled: true, permissions: null }),
    ).toBeNull();
  });
});

describe("matterCloseChecklist", () => {
  const trustRefusal = {
    code: "trust-balance-not-zero",
    reason: "This matter still holds $1,250.00 on the Operating IOLTA trust ledger.",
  };
  const creditRefusal = {
    code: "client-credit-open",
    reason: "This matter carries $80.00 the firm owes back to the client.",
  };

  it("ticks nothing before a close has asked", () => {
    // The rules are not readable from the window today, and a tick nobody verified would be a lie
    // told in the one place a person is deciding whether to close somebody's file.
    const rows = matterCloseChecklist(null);
    expect(rows).toHaveLength(MATTER_CLOSE_REQUIREMENTS.length);
    expect(rows.every((row) => row.state === "unknown")).toBe(true);
    expect(rows.every((row) => row.reasons.length === 0)).toBe(true);
  });

  it("resolves the whole list from one refusal, because silence about a rule is that rule passing", () => {
    const rows = matterCloseChecklist([trustRefusal]);
    const trust = rows.find((row) => row.key === "trust");
    const credit = rows.find((row) => row.key === "client-credit");
    expect(trust?.state).toBe("blocked");
    expect(trust?.reasons).toEqual([trustRefusal.reason]);
    expect(credit?.state).toBe("met");
    expect(credit?.reasons).toEqual([]);
  });

  it("blocks every rule that refused", () => {
    const rows = matterCloseChecklist([trustRefusal, creditRefusal]);
    expect(rows.filter((row) => row.state === "blocked")).toHaveLength(2);
  });

  it("carries a rule this build has never heard of rather than dropping it", () => {
    // A precondition registered server-side after this screen shipped is the one a person most
    // needs to read, and it is the one a fixed list would silently swallow.
    const rows = matterCloseChecklist([
      { code: "some-rule-shipped-later", reason: "The matter is under a litigation hold." },
    ]);
    const carried = rows.find((row) => row.key === "some-rule-shipped-later");
    expect(carried?.state).toBe("blocked");
    expect(carried?.label).toBe("The matter is under a litigation hold.");
    expect(carried?.section).toBeNull();
  });

  it("points every requirement it knows at a section that exists", () => {
    for (const requirement of MATTER_CLOSE_REQUIREMENTS) {
      expect(matterSections.some((section) => section.slug === requirement.section)).toBe(true);
    }
  });
});

describe("matterCloseConsiderations", () => {
  const money = (amountMinor: number): string => `$${(amountMinor / 100).toFixed(2)}`;

  it("says nothing where the firm holds nothing against the matter", () => {
    // A block with nothing in it is not drawn, so an empty answer is the whole contract here.
    expect(
      matterCloseConsiderations({
        unbilled: {
          timeEntryCount: 0,
          timeAmountMinor: 0,
          costEntryCount: 0,
          costAmountMinor: 0,
          receivableUnpaidMinor: 0,
        },
        custodyPacketCount: 0,
        money,
      }),
    ).toEqual([]);
  });

  it("says nothing it has not read", () => {
    expect(matterCloseConsiderations({ unbilled: null, custodyPacketCount: null, money })).toEqual(
      [],
    );
  });

  it("names unbilled work, what is still owed, and what the firm physically holds", () => {
    const considerations = matterCloseConsiderations({
      unbilled: {
        timeEntryCount: 3,
        timeAmountMinor: 390_000,
        costEntryCount: 1,
        costAmountMinor: 22_000,
        receivableUnpaidMinor: 180_000,
      },
      custodyPacketCount: 2,
      money,
    });
    expect(considerations.map((one) => one.key)).toEqual(["unbilled", "receivable", "custody"]);
    expect(considerations[0]?.line).toContain("3 time entries and 1 cost");
    expect(considerations[0]?.line).toContain("$4120.00");
    // Each one carries the clause without which the finding would read as a blocker.
    expect(considerations[1]?.line).toContain("does not stop a close");
    expect(considerations[2]?.line).toContain("stays in the safe-custody register");
  });

  it("counts one of a thing as one of a thing", () => {
    const considerations = matterCloseConsiderations({
      unbilled: {
        timeEntryCount: 1,
        timeAmountMinor: 30_000,
        costEntryCount: 0,
        costAmountMinor: 0,
        receivableUnpaidMinor: 0,
      },
      custodyPacketCount: 1,
      money,
    });
    expect(considerations[0]?.line).toContain("1 time entry and 0 costs");
    expect(considerations[1]?.line).toContain("1 packet");
  });

  it("points every consideration at a section that exists", () => {
    const considerations = matterCloseConsiderations({
      unbilled: {
        timeEntryCount: 1,
        timeAmountMinor: 1,
        costEntryCount: 1,
        costAmountMinor: 1,
        receivableUnpaidMinor: 1,
      },
      custodyPacketCount: 1,
      money,
    });
    for (const consideration of considerations) {
      expect(matterSections.some((section) => section.slug === consideration.section)).toBe(true);
    }
  });
});
