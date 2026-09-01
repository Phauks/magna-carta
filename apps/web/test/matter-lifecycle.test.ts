/*
 * The status window's model, pinned. What is worth a test here is everything a person reads
 * immediately before a matter's status changes:
 *
 *   - every status offers one step, and it is the step the contract actually serves;
 *   - what closing requires, answered by the rules rather than by the reader, with "nobody could
 *     ask" kept distinct from "a rule said no" — only one of those is something a person can act on;
 *   - a refused close reads in the shape the requirements are already in, so the window never grows
 *     a second account of the same fact;
 *   - the physical-file rows say what they wait on and invent nothing, least of all a date somebody
 *     would destroy a client's file on.
 */
import { describe, expect, it } from "vitest";
import {
  matterCanClose,
  matterCloseRefusals,
  matterCloseRequirements,
  matterLifecycleBlock,
  matterLifecycleStep,
  CLOSE_REFUSED_PROBLEM_TYPE,
  MATTER_LIFECYCLE_STEPS,
  MATTER_PHYSICAL_FILE_FACTS,
  MATTER_PHYSICAL_FILE_NOTE,
  MATTER_PHYSICAL_FILE_WAITING_ON,
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

describe("matterCloseRequirements", () => {
  const held = {
    code: "trust-balance-not-zero",
    message: "this matter still holds $1,250.00 on the IOLTA trust ledger.",
  };

  it("is checking, not unmet, until the program has answered", () => {
    // An unanswered requirement rendered as a failure is a firm told there is money on a matter
    // that has none.
    const rows = matterCloseRequirements(null);
    expect(rows.every((row) => row.state === "checking")).toBe(true);
    expect(rows.every((row) => row.detail === null)).toBe(true);
    expect(matterCanClose(null)).toBeNull();
  });

  it("marks every requirement met when nothing is in the way", () => {
    const rows = matterCloseRequirements({
      matterId: "matter_1",
      status: "open",
      closable: true,
      blockers: [],
    });
    expect(rows.every((row) => row.state === "met")).toBe(true);
    expect(rows.map((row) => row.label).every((label) => label.length > 0)).toBe(true);
  });

  it("answers every requirement from one reply: a rule not named is a rule that passed", () => {
    const rows = matterCloseRequirements({
      matterId: "matter_1",
      status: "open",
      closable: false,
      blockers: [held],
    });
    const trust = rows.find((row) => row.key === "trust");
    const credit = rows.find((row) => row.key === "client-credit");
    expect(trust?.state).toBe("unmet");
    // Only the leading character is the surface's: the amount and the ledger name are the server's.
    expect(trust?.detail).toBe("This matter still holds $1,250.00 on the IOLTA trust ledger.");
    expect(credit?.state).toBe("met");
    expect(credit?.detail).toBeNull();
  });

  it("carries a rule this build has never heard of rather than dropping it", () => {
    const rows = matterCloseRequirements({
      matterId: "matter_1",
      status: "open",
      closable: false,
      blockers: [
        { code: "some-rule-shipped-later", message: "the matter is under a litigation hold." },
      ],
    });
    const carried = rows.find((row) => row.key === "some-rule-shipped-later");
    expect(carried?.state).toBe("unmet");
    expect(carried?.label).toBe("The matter is under a litigation hold.");
  });

  it("keeps a question nobody could ask apart from a rule that said no", () => {
    // Unknown must not disable a close the rules never refused, and must not read as a refusal.
    const rows = matterCloseRequirements(null, true);
    expect(rows.every((row) => row.state === "unknown")).toBe(true);
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
    // The rule's own words, untouched: the requirement list is where the capital is put on, because
    // that is the surface that renders the sentence on its own line.
    expect(refusals).toEqual([
      {
        code: "client-credit-open",
        message: "this matter carries $80.00 the firm owes back to the client.",
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
  it("names where the file is kept and when it may be destroyed", () => {
    expect(MATTER_PHYSICAL_FILE_FACTS.map((fact) => fact.key)).toEqual([
      "location",
      "container",
      "destroy-after",
    ]);
  });

  it("says what it waits on once, in the sentence every unserved capability uses", () => {
    expect(MATTER_PHYSICAL_FILE_WAITING_ON.startsWith("Not built yet. Waiting on ")).toBe(true);
  });

  it("waits on the firm's OWN file register, never on the custody register", () => {
    // The two get confused, and the confusion would put a client's will where a firm's paper file
    // belongs: Custodian holds client property left with the firm to guard, which outlives the
    // matter that brought it in. What this panel waits on is a different register that does not
    // exist.
    expect(MATTER_PHYSICAL_FILE_WAITING_ON).toContain("the firm's own physical files");
    expect(MATTER_PHYSICAL_FILE_WAITING_ON).not.toContain("custody");
  });

  it("invents no destruction date", () => {
    expect(MATTER_PHYSICAL_FILE_WAITING_ON).toContain("retention policy");
    expect(MATTER_PHYSICAL_FILE_WAITING_ON).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("says the status does not move the file, because the layout would imply it does", () => {
    // A firm keeps a matter's folder in a box with other matters' folders at a remote store, and
    // closing the matter changes none of that.
    expect(MATTER_PHYSICAL_FILE_NOTE).toContain("does not move the file");
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
