/*
 * The lifecycle model behind the status window and the panel that changes the status, pinned. What
 * is worth a test here is everything a person reads immediately before a matter's status changes:
 *
 *   - every status offers one step, and it is the step the contract actually serves;
 *   - every step says what it would do to the record, because the panel states that beside it;
 *   - where each step STANDS: what it requires, answered by the rules rather than by the reader,
 *     with "nobody could ask" kept distinct from "a rule said no" — only one of those is something
 *     a person can act on;
 *   - a refused close reads in the shape the requirements are already in, so the panel never grows
 *     a second account of the same fact;
 *   - the physical-file rows say what they wait on and invent nothing, least of all a date somebody
 *     would destroy a client's file on.
 */
import { describe, expect, it } from "vitest";
import {
  matterCanClose,
  matterCanOpen,
  matterCloseRefusals,
  matterCloseRequirements,
  matterOpenRefusals,
  matterOpenRequirements,
  matterStepStanding,
  OPEN_REFUSED_PROBLEM_TYPE,
  matterLifecycleBlock,
  matterLifecycleStep,
  CLOSE_REFUSED_PROBLEM_TYPE,
  holdReasonRefusal,
  matterLifecycleSteps,
  MATTER_LIFECYCLE_STEPS,
  MATTER_PHYSICAL_FILE_FACTS,
  earliestFileDestructionDate,
  fileDestructionDateRefusal,
  NO_LIFECYCLE_READINESS,
} from "../src/lib/matters/matter-lifecycle.ts";
import { MATTER_STATUSES } from "../src/lib/matters/matter-status.ts";

type Status = (typeof MATTER_STATUSES)[number];

/** The one step a status offers under this name, or a failure naming what was missing. */
function stepFor(status: Status, action: string) {
  const step = matterLifecycleSteps(status).find((one) => one.action === action);
  if (step === undefined) throw new Error(`no ${action} step on ${status}`);
  return step;
}

describe("matterLifecycleStep", () => {
  it("leads with the step the lifecycle runs toward, for every status", () => {
    expect(matterLifecycleStep("intake").action).toBe("graduate");
    expect(matterLifecycleStep("consultation").action).toBe("open");
    expect(matterLifecycleStep("open").action).toBe("close");
    expect(matterLifecycleStep("hold").action).toBe("release");
    expect(matterLifecycleStep("closed").action).toBe("reopen");
  });

  it("offers the pause beside the close on an active matter, and the close beside the release on a held one", () => {
    expect(matterLifecycleSteps("open").map((step) => step.action)).toEqual(["close", "hold"]);
    expect(matterLifecycleSteps("hold").map((step) => step.action)).toEqual(["release", "close"]);
    // The intake and the closed matter offer exactly one way forward.
    expect(matterLifecycleSteps("intake")).toHaveLength(1);
    expect(matterLifecycleSteps("closed")).toHaveLength(1);
  });

  it("lets a consultation be put on hold or closed, not only opened", () => {
    // A firm that parks a consultation, or decides against one, says so from the consultation
    // itself. The open still leads: it is the step the lifecycle runs toward.
    expect(matterLifecycleSteps("consultation").map((step) => step.action)).toEqual([
      "open",
      "hold",
      "close",
    ]);
    const close = matterLifecycleSteps("consultation").find((step) => step.action === "close");
    // The close names what it closes, and its sentence says what a declined consultation keeps:
    // the tentative number, and never a matter number.
    expect(close?.label).toBe("Close Consultation");
    expect(close?.doneSentence).toContain("doesn't get a matter number");
    const hold = matterLifecycleSteps("consultation").find((step) => step.action === "hold");
    expect(hold?.doneSentence).toContain("consultation again when released");
    expect(hold?.doneSentence).not.toContain("active");
  });

  it("says what every step would do to the record, before it is taken", () => {
    // The status-change panel states this beside the chosen step. The three steps no rule gates —
    // the pause, its release and the reopen — have nothing else to read, so a missing sentence
    // there is a reader asked to press a verb with nothing said about what it does.
    for (const status of MATTER_STATUSES) {
      for (const step of matterLifecycleSteps(status)) {
        expect(step.consequence.length).toBeGreaterThan(0);
        expect(step.consequence).toMatch(/\.$/);
      }
    }
    // Each one names the number, because the number is what a reader is most often wrong about.
    expect(stepFor("consultation", "open").consequence).toContain("matter number");
    expect(stepFor("consultation", "close").consequence).toContain("doesn't get a matter number");
    expect(stepFor("intake", "graduate").consequence).toContain("consultation number");
    expect(stepFor("closed", "reopen").consequence).toContain("number stays the same");
  });

  it("covers every status the contract stores", () => {
    for (const status of MATTER_STATUSES) {
      expect(matterLifecycleStep(status).label).not.toBe("");
    }
  });

  it("names the permission each endpoint enforces", () => {
    expect(matterLifecycleStep("intake").permission).toBe("matters:create");
    expect(matterLifecycleStep("consultation").permission).toBe("matters:open");
    expect(matterLifecycleStep("open").permission).toBe("matters:close");
    expect(matterLifecycleStep("closed").permission).toBe("matters:reopen");
    // The pause and its release are one authority in two directions, on a consultation as on an
    // active matter; and a consultation's close is the close's own authority.
    for (const step of [
      ...MATTER_LIFECYCLE_STEPS.open,
      ...MATTER_LIFECYCLE_STEPS.hold,
      ...MATTER_LIFECYCLE_STEPS.consultation,
    ]) {
      if (step.action === "hold" || step.action === "release") {
        expect(step.permission).toBe("matters:hold");
      }
      if (step.action === "close") expect(step.permission).toBe("matters:close");
    }
  });
});

describe("holdReasonRefusal", () => {
  it("refuses a blank reason and one too long for a row, and accepts a sentence", () => {
    expect(holdReasonRefusal("")).not.toBeNull();
    expect(holdReasonRefusal("   ")).not.toBeNull();
    expect(holdReasonRefusal("x".repeat(501))).not.toBeNull();
    expect(holdReasonRefusal("The client has not paid the last two invoices.")).toBeNull();
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

  it("reads nothing where the refusal named no rules at all", () => {
    // An entry missing any of path, code or detail never reaches here: the transport's own reader
    // (lib/api/problem.ts) drops it, so this surface is not a second place that decides what a
    // half-written problem document means.
    expect(matterCloseRefusals({ status: 409, type: CLOSE_REFUSED_PROBLEM_TYPE })).toEqual([]);
  });
});

describe("matterStepStanding", () => {
  it("has nothing to check for a step no rule gates", () => {
    // The release, the reopen and the pause are gated by the permission alone, which is a different
    // sentence and a different function. Rows here would be a list with nothing in it.
    for (const step of [
      stepFor("hold", "release"),
      stepFor("closed", "reopen"),
      stepFor("open", "hold"),
    ]) {
      const standing = matterStepStanding(step, NO_LIFECYCLE_READINESS);
      expect(standing.requirements).toEqual([]);
      expect(standing.refused).toBe(false);
      expect(standing.summary).toBe("Nothing stands in the way.");
    }
  });

  it("is checking, never refused, until the rules have answered", () => {
    // A step shut on the strength of an unanswered question refuses somebody nothing is wrong with.
    const standing = matterStepStanding(stepFor("open", "close"), NO_LIFECYCLE_READINESS);
    expect(standing.refused).toBe(false);
    expect(standing.summary).toBe("Checking what this requires.");
    expect(standing.requirements.every((row) => row.state === "checking")).toBe(true);
  });

  it("counts what is not met, and carries the rule's own words", () => {
    const standing = matterStepStanding(stepFor("open", "close"), {
      ...NO_LIFECYCLE_READINESS,
      close: {
        matterId: "matter_1",
        status: "open",
        closable: false,
        blockers: [
          {
            code: "trust-balance-not-zero",
            message: "this matter still holds $1,250.00 on the IOLTA trust ledger.",
          },
        ],
      },
    });
    expect(standing.refused).toBe(true);
    expect(standing.summary).toBe("One requirement is not met.");
    const trust = standing.requirements.find((row) => row.key === "trust");
    expect(trust?.detail).toBe("This matter still holds $1,250.00 on the IOLTA trust ledger.");
  });

  it("states one met row for a step the firm's own procedure gates, so the panel always has a list", () => {
    // The open and the intake's completion have no roster to state as met — what they must clear is
    // the firm's to write and may be nothing at all. A single row saying so is what keeps the panel
    // rendering a structure rather than a sentence standing where the structure would be.
    const standing = matterStepStanding(stepFor("consultation", "open"), {
      ...NO_LIFECYCLE_READINESS,
      open: { matterId: "matter_1", status: "consultation", openable: true, blockers: [] },
    });
    expect(standing.requirements).toHaveLength(1);
    expect(standing.requirements[0]?.state).toBe("met");
    expect(standing.refused).toBe(false);
    expect(standing.summary).toBe("Nothing stands in the way.");
  });

  it("keeps a question nobody could ask apart from a rule that said no", () => {
    const standing = matterStepStanding(stepFor("intake", "graduate"), {
      ...NO_LIFECYCLE_READINESS,
      graduateFailed: true,
    });
    expect(standing.unanswered).toBe(true);
    expect(standing.refused).toBe(false);
    expect(standing.requirements.every((row) => row.state === "unknown")).toBe(true);
    expect(standing.summary).toBe("This could not be checked. Taking the step will check it.");
  });

  it("counts past one in figures", () => {
    const standing = matterStepStanding(stepFor("intake", "graduate"), {
      ...NO_LIFECYCLE_READINESS,
      graduate: {
        matterId: "matter_1",
        status: "intake",
        graduable: false,
        blockers: [
          { code: "intake-step-outstanding", message: 'the step "Conflicts check" is outstanding' },
          { code: "intake-step-outstanding", message: 'the step "Verify identity" is outstanding' },
        ],
      },
    });
    expect(standing.summary).toBe("2 requirements are not met.");
    expect(standing.requirements).toHaveLength(2);
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

  it("assumes no medium: firms use boxes, cabinets, safes, shelves", () => {
    // A row called Box would decide, for every firm, what a file is kept in. What holds a file is a
    // record with a kind of its own, and this screen must not pre-empt it with a word.
    const labels = MATTER_PHYSICAL_FILE_FACTS.map((fact) => fact.label.toLowerCase()).join(" ");
    for (const medium of ["box", "cabinet", "safe", "shelf", "drawer", "crate"]) {
      expect(labels).not.toContain(medium);
    }
  });

  it("is labels and nothing else, so no row can grow prose again", () => {
    // The rows carried a sentence naming what they wait on and a note about the close; the owner
    // removed both. A row states its name, whether the record carries it, and nothing more — the
    // value beside an unserved row is what says it holds nothing.
    for (const fact of MATTER_PHYSICAL_FILE_FACTS) {
      expect(Object.keys(fact).toSorted()).toEqual(["key", "label", "served"]);
    }
  });

  it("serves where the file is kept and the date the firm stated, and not what holds it", () => {
    // Location resolves to one of the firm's own offices, which is a record the product holds.
    // Destroy After is a date a person at the firm records — never one derived, because a date
    // made up here would be a date somebody destroys a client's file on. What a folder sits INSIDE
    // is a record that does not exist, so it stays marked Soon rather than being invented.
    const served = MATTER_PHYSICAL_FILE_FACTS.filter((fact) => fact.served).map((fact) => fact.key);
    expect(served).toEqual(["location", "destroy-after"]);
  });
});

describe("matterLifecycleBlock", () => {
  const step = matterLifecycleStep("open");

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

describe("what opening requires", () => {
  const blockers = [
    {
      code: "intake-step-outstanding",
      message: 'the intake step "Run the conflicts check" is outstanding',
    },
    {
      code: "intake-step-outstanding",
      message: 'the intake step "Verify identity" is outstanding',
    },
  ];

  it("is exactly the refusals the rules returned, each capitalised, and nothing while unanswered", () => {
    expect(matterOpenRequirements(null)).toEqual([]);
    expect(matterOpenRequirements(null, true)).toEqual([]);
    const rows = matterOpenRequirements({
      matterId: "matter_a",
      status: "consultation",
      openable: false,
      blockers,
    });
    expect(rows.map((row) => [row.state, row.label])).toEqual([
      ["unmet", 'The intake step "Run the conflicts check" is outstanding'],
      ["unmet", 'The intake step "Verify identity" is outstanding'],
    ]);
    // Two refusals under one code still get two distinct keys.
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  it("answers whether the consultation would open only once the rules have", () => {
    expect(matterCanOpen(null)).toBeNull();
    expect(
      matterCanOpen({ matterId: "matter_a", status: "consultation", openable: true, blockers: [] }),
    ).toBe(true);
  });

  it("reads a refused open in the shape the requirements are already in", () => {
    expect(
      matterOpenRefusals({
        type: OPEN_REFUSED_PROBLEM_TYPE,
        title: "Matter cannot be opened yet",
        status: 409,
        errors: blockers.map((blocker) => ({
          path: "$",
          code: blocker.code,
          detail: blocker.message,
        })),
      }),
    ).toEqual(blockers);
    expect(matterOpenRefusals({ type: "conflict", title: "Conflict", status: 409 })).toEqual([]);
  });
});

describe("the destruction date the close asks for", () => {
  it("offers the firm's floor: the day of the close plus its minimum, a leap day rolling forward", () => {
    expect(earliestFileDestructionDate("2026-11-09", 7)).toBe("2033-11-09");
    expect(earliestFileDestructionDate("2028-02-29", 1)).toBe("2029-03-01");
    expect(earliestFileDestructionDate("2026-11-09", 0)).toBeNull();
  });

  it("takes the floor, a later date, or none, and refuses an earlier date or no answer", () => {
    expect(fileDestructionDateRefusal("2033-11-09", "2033-11-09")).toBeNull();
    expect(fileDestructionDateRefusal("2040-01-01", "2033-11-09")).toBeNull();
    expect(fileDestructionDateRefusal(null, "2033-11-09")).toBeNull();
    expect(fileDestructionDateRefusal("2033-11-08", "2033-11-09")).toContain("2033-11-09");
    expect(fileDestructionDateRefusal("", null)).toContain("No Destruction Date");
    // With no minimum, any chosen date stands.
    expect(fileDestructionDateRefusal("2027-01-01", null)).toBeNull();
  });
});
