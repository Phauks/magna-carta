/*
 * The status window's model, pinned. What is worth a test here is everything a person reads
 * immediately before a matter's standing changes:
 *
 *   - every status offers one step, and it is the step the contract actually serves;
 *   - the verdict on closing is the program's answer, with "nobody could ask" kept distinct from
 *     "a rule said no" — only one of those is something a person can act on;
 *   - a refused close reads in the same shape the verdict does, so the window never grows a second
 *     account of the same fact;
 *   - the physical-file rows say what they wait on and invent nothing, least of all a date somebody
 *     would destroy a client's file on.
 */
import { describe, expect, it } from "vitest";
import {
  matterCloseRefusals,
  matterCloseStanding,
  matterLifecycleBlock,
  matterLifecycleStep,
  CLOSE_REFUSED_PROBLEM_TYPE,
  MATTER_LIFECYCLE_STEPS,
  MATTER_PHYSICAL_FILE_FACTS,
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

  it("names the permission each endpoint enforces", () => {
    expect(MATTER_LIFECYCLE_STEPS.prospective.permission).toBe("matters:open");
    expect(MATTER_LIFECYCLE_STEPS.open.permission).toBe("matters:close");
    expect(MATTER_LIFECYCLE_STEPS.closed.permission).toBe("matters:reopen");
  });
});

describe("matterCloseStanding", () => {
  it("is checking until the program has answered", () => {
    const standing = matterCloseStanding(null);
    expect(standing.verdict).toBe("checking");
    expect(standing.blockers).toEqual([]);
  });

  it("reads yes as yes", () => {
    const standing = matterCloseStanding({
      matterId: "matter_1",
      status: "open",
      closable: true,
      blockers: [],
    });
    expect(standing.verdict).toBe("ready");
    expect(standing.sentence).toBe("Ready to close.");
  });

  it("keeps each rule's own words, with the capital the rule did not supply", () => {
    const standing = matterCloseStanding({
      matterId: "matter_1",
      status: "open",
      closable: false,
      blockers: [
        {
          code: "trust-balance-not-zero",
          message: "this matter still holds $1,250.00 on the IOLTA trust ledger.",
        },
      ],
    });
    expect(standing.verdict).toBe("blocked");
    // Only the leading character is the surface's: the amounts and the ledger name are the server's.
    expect(standing.blockers[0]?.message).toBe(
      "This matter still holds $1,250.00 on the IOLTA trust ledger.",
    );
    expect(standing.blockers[0]?.code).toBe("trust-balance-not-zero");
  });

  it("keeps a question nobody could ask apart from a rule that said no", () => {
    // Rendering an unreadable answer as a refusal would send somebody looking for money that is not
    // there, and would disable a close the rules never refused.
    const standing = matterCloseStanding(null, true);
    expect(standing.verdict).toBe("unknown");
    expect(standing.blockers).toEqual([]);
  });
});

describe("matterCloseRefusals", () => {
  it("reads a last-moment refusal in the shape the verdict already holds", () => {
    const refusals = matterCloseRefusals({
      status: 409,
      type: CLOSE_REFUSED_PROBLEM_TYPE,
      detail: "One or more close preconditions refused this matter.",
      errors: [
        {
          path: "$",
          code: "client-credit-open",
          detail: "this matter carries $80.00 the firm owes back to the client.",
        },
      ],
    });
    expect(refusals).toEqual([
      {
        code: "client-credit-open",
        message: "This matter carries $80.00 the firm owes back to the client.",
      },
    ]);
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

describe("the physical file", () => {
  it("states where the file is and when it may be destroyed, and serves neither yet", () => {
    expect(MATTER_PHYSICAL_FILE_FACTS.map((fact) => fact.key)).toEqual([
      "location",
      "destroy-after",
    ]);
    for (const fact of MATTER_PHYSICAL_FILE_FACTS) {
      // The one sentence every not-yet-served capability in the product says about itself.
      expect(fact.waitingOn.startsWith("Not built yet. Waiting on ")).toBe(true);
      expect(fact.label).not.toBe("");
    }
  });

  it("waits on the firm's OWN file register, never on the custody register", () => {
    // The two get confused, and the confusion would put a client's will where a firm's paper file
    // belongs: Custodian holds client property left with the firm to guard, which outlives the
    // matter that brought it in. What this row waits on is a different register that does not exist.
    const location = MATTER_PHYSICAL_FILE_FACTS.find((fact) => fact.key === "location");
    expect(location?.waitingOn).toContain("the firm's own physical files");
    expect(location?.waitingOn).not.toContain("custody");
  });

  it("invents no destruction date", () => {
    const destroy = MATTER_PHYSICAL_FILE_FACTS.find((fact) => fact.key === "destroy-after");
    expect(destroy?.waitingOn).toContain("retention policy");
    expect(destroy?.waitingOn).not.toMatch(/\d{4}-\d{2}-\d{2}/);
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
