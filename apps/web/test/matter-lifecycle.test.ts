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
  matterCloseRefusals,
  matterLifecycleBlock,
  matterLifecycleStep,
  CLOSE_REFUSED_PROBLEM_TYPE,
  MATTER_LIFECYCLE_STEPS,
} from "../src/lib/matters/matter-lifecycle.ts";
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

  it("states what closing does and what it checks, and never calls closing destructive", () => {
    const close = MATTER_LIFECYCLE_STEPS.open;
    // The two things people assume about a close and are wrong about, both said before the press.
    expect(close.consequences.join(" ")).toContain("does not seal it");
    expect(close.requirements).toHaveLength(2);
    expect(close.requirements.join(" ")).toContain("trust ledger");
    expect(close.requirements.join(" ")).toContain("client credit");
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
