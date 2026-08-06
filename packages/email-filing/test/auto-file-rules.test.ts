import { describe, expect, it } from "vitest";
import {
  AUTO_FILE_MAX_FIRES_PER_WINDOW,
  AUTO_FILE_MAX_UNDOS_IN_RECENT_FIRES,
  resolveAutoFileDecision,
  type AutoFileCandidateRule,
  type AutoFileEvidence,
} from "../src/auto-file-rules.ts";

const MATTER = "matter_smithEstate00000";
const OTHER_MATTER = "matter_jonesLease00000";
const THREAD_RULE = "emailAutoFileRule_thread";
const SENDER_RULE = "emailAutoFileRule_sender";

function threadRule(overrides: Partial<AutoFileCandidateRule> = {}): AutoFileCandidateRule {
  return {
    ruleId: THREAD_RULE,
    kind: "threadContinuation",
    matterId: MATTER,
    matchValue: "emailThread_a",
    promotion: "file",
    state: "active",
    creatorRetainsMatterAccess: true,
    firesInWindow: 0,
    undosInRecentFires: 0,
    ...overrides,
  };
}

function senderRule(overrides: Partial<AutoFileCandidateRule> = {}): AutoFileCandidateRule {
  return {
    ruleId: SENDER_RULE,
    kind: "correspondentMatter",
    matterId: MATTER,
    matchValue: "counsel@opposing.example",
    promotion: "file",
    state: "active",
    creatorRetainsMatterAccess: true,
    firesInWindow: 0,
    undosInRecentFires: 0,
    ...overrides,
  };
}

// The everything-is-permitted baseline, so each test below changes exactly the one fact it is about.
// A capture from the add-in carries the message's own bytes, which is what makes a signature
// answerable at all.
function evidence(overrides: Partial<AutoFileEvidence> = {}): AutoFileEvidence {
  return {
    matchedRules: [threadRule()],
    threadMatterIds: [MATTER],
    subjectMatterIds: [],
    existingLinks: [],
    dkimVerdict: "pass",
    dkimVerifiedDomain: "opposing.example",
    // The ordinary case: the signature covered the whole body. A signature carrying `l=` covers only a
    // prefix, and the cases that exercise that are explicit about it.
    dkimBodyFullyCovered: true,
    capturedVia: "addin",
    targetMatters: [{ matterId: MATTER, status: "open", systemOwned: false }],
    conflictHold: false,
    firmDirectFilingPermitted: true,
    ...overrides,
  };
}

// No reason sentence may carry anything a correspondent wrote or a mailbox a person owns: the whole
// point of the phrasing table is that the ledger holds enums and the sentences are rendered from them.
function assertNoMessageContent(reasons: readonly string[]): void {
  for (const reason of reasons) {
    expect(reason).not.toContain("@");
    expect(reason.toLowerCase()).not.toContain("smith");
  }
}

describe("the baseline — a rule that every guardrail permits", () => {
  it("files, naming its rule and its matter", () => {
    const decision = resolveAutoFileDecision(evidence());
    expect(decision.outcome).toBe("file");
    expect(decision.matterId).toBe(MATTER);
    expect(decision.ruleId).toBe(THREAD_RULE);
    expect(decision.suppressionReason).toBeNull();
    expect(decision.demotionReason).toBeNull();
    expect(decision.suspension).toBeNull();
    assertNoMessageContent(decision.reasons);
  });

  it("decides nothing at all when no rule looked at the message", () => {
    const decision = resolveAutoFileDecision(evidence({ matchedRules: [] }));
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBeNull();
    expect(decision.ruleId).toBeNull();
    // Nothing happened, so there is nothing for the ledger to record.
    expect(decision.reasons).toEqual([]);
  });
});

describe("a rule that only ever stages", () => {
  it("places the message on the matter and leaves the filing to a person, recording its evidence", () => {
    const decision = resolveAutoFileDecision(
      evidence({ matchedRules: [threadRule({ promotion: "stage" })] }),
    );
    expect(decision.outcome).toBe("stage");
    expect(decision.matterId).toBe(MATTER);
    expect(decision.ruleId).toBe(THREAD_RULE);
    expect(decision.demotionReason).toBe("rulePosture");
    expect(decision.suppressionReason).toBeNull();
    expect(decision.reasons).toHaveLength(2);
    assertNoMessageContent(decision.reasons);
  });

  it("stages under a firm that has not enabled direct filing, whatever the rule asked for", () => {
    const decision = resolveAutoFileDecision(evidence({ firmDirectFilingPermitted: false }));
    expect(decision.outcome).toBe("stage");
    expect(decision.matterId).toBe(MATTER);
    expect(decision.demotionReason).toBe("firmPolicyDirectFilingOff");
  });

  it("stages behind a conflict hold rather than filing past it", () => {
    const decision = resolveAutoFileDecision(evidence({ conflictHold: true }));
    expect(decision.outcome).toBe("stage");
    expect(decision.matterId).toBe(MATTER);
    expect(decision.demotionReason).toBe("conflictHold");
  });

  it("files when the conflict hook has nothing to say", () => {
    expect(resolveAutoFileDecision(evidence({ conflictHold: false })).outcome).toBe("file");
  });
});

describe("never fire on ambiguity", () => {
  it("suppresses when two rules disagree about the matter", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [threadRule(), senderRule({ matterId: OTHER_MATTER })],
        threadMatterIds: [MATTER],
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("ambiguousEvidence");
    assertNoMessageContent(decision.reasons);
  });

  it("suppresses when a rule points one way and the subject line names another matter", () => {
    const decision = resolveAutoFileDecision(evidence({ subjectMatterIds: [OTHER_MATTER] }));
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("ambiguousEvidence");
  });

  it("suppresses when the thread resolves to two matters", () => {
    const decision = resolveAutoFileDecision(evidence({ threadMatterIds: [MATTER, OTHER_MATTER] }));
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("ambiguousEvidence");
  });

  it("does not suppress when every deciding signal agrees", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [threadRule(), senderRule()],
        threadMatterIds: [MATTER],
        subjectMatterIds: [MATTER],
      }),
    );
    expect(decision.outcome).toBe("file");
    expect(decision.matterId).toBe(MATTER);
  });

  it("picks the same rule every time when several name the one matter", () => {
    const first = resolveAutoFileDecision(
      evidence({ matchedRules: [threadRule({ promotion: "stage" }), senderRule()] }),
    );
    const second = resolveAutoFileDecision(
      evidence({ matchedRules: [senderRule(), threadRule({ promotion: "stage" })] }),
    );
    expect(first.ruleId).toBe(second.ruleId);
    expect(first.outcome).toBe(second.outcome);
  });
});

describe("never across a wall, and never on withdrawn access", () => {
  it("suspends the rule and files nothing when its creator can no longer open the matter", () => {
    const decision = resolveAutoFileDecision(
      evidence({ matchedRules: [threadRule({ creatorRetainsMatterAccess: false })] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("creatorAccessWithdrawn");
    expect(decision.suspension).toEqual({
      ruleId: THREAD_RULE,
      reason: "creatorAccessWithdrawn",
    });
    assertNoMessageContent(decision.reasons);
  });

  it("refuses on an unanswerable access question, without claiming access was withdrawn", () => {
    const decision = resolveAutoFileDecision(
      evidence({ matchedRules: [threadRule({ creatorRetainsMatterAccess: null })] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("incompleteEvidence");
    expect(decision.suspension).toBeNull();
  });

  it("does not suppress a creator who still holds access", () => {
    expect(
      resolveAutoFileDecision(
        evidence({ matchedRules: [threadRule({ creatorRetainsMatterAccess: true })] }),
      ).outcome,
    ).toBe("file");
  });
});

describe("the signature gates the robot, not the record", () => {
  it("refuses every kind on a signature that failed, when the capture carried the original", () => {
    const decision = resolveAutoFileDecision(evidence({ dkimVerdict: "fail" }));
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("signatureFailed");
    assertNoMessageContent(decision.reasons);
  });

  it("treats an unverified verdict as no answer, never as no", () => {
    const decision = resolveAutoFileDecision(
      evidence({ dkimVerdict: "unverified", dkimVerifiedDomain: null }),
    );
    expect(decision.outcome).toBe("file");
    expect(decision.suppressionReason).toBeNull();
  });

  it("ignores a failed signature on a forward, where there was no original to check", () => {
    // Forwarding rewrites headers, so a `fail` on that path is a fact about the forwarder's mail
    // client rather than about the sender.
    const decision = resolveAutoFileDecision(
      evidence({ capturedVia: "forward", dkimVerdict: "fail", dkimVerifiedDomain: null }),
    );
    expect(decision.outcome).toBe("file");
  });

  it("lets a sender rule fire on an intact original whose verified domain matches the rule address", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [senderRule()],
        threadMatterIds: [],
        dkimVerdict: "pass",
        dkimVerifiedDomain: "opposing.example",
      }),
    );
    expect(decision.outcome).toBe("file");
    expect(decision.ruleId).toBe(SENDER_RULE);
  });

  it("refuses a sender rule on a pass whose domain is not the rule address's domain", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [senderRule()],
        threadMatterIds: [],
        dkimVerdict: "pass",
        dkimVerifiedDomain: "lookalike.example",
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("senderNotAuthenticated");
  });

  it("never fires a sender rule on a forwarded capture — the platform cannot tell who sent it", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [senderRule()],
        threadMatterIds: [],
        capturedVia: "forward",
        dkimVerdict: "pass",
        dkimVerifiedDomain: "opposing.example",
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("senderNotAuthenticated");
  });

  it("refuses a sender rule when the sender is merely unverified", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [senderRule()],
        threadMatterIds: [],
        dkimVerdict: "unverified",
        dkimVerifiedDomain: null,
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("senderNotAuthenticated");
  });

  it("refuses a sender rule whose match value is not an address at all", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [senderRule({ matchValue: "opposing.example" })],
        threadMatterIds: [],
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("incompleteEvidence");
  });
});

describe("never over a human decision", () => {
  it("never refiles a message a person unlinked from this matter", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        existingLinks: [{ matterId: MATTER, state: "unlinked", automatic: false }],
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("humanFilingDecision");
    assertNoMessageContent(decision.reasons);
  });

  it("never refiles a message whose automatic link a person undid", () => {
    // The undo is the person's act whoever made the link, so the origin of the link is irrelevant.
    const decision = resolveAutoFileDecision(
      evidence({ existingLinks: [{ matterId: MATTER, state: "unlinked", automatic: true }] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("humanFilingDecision");
  });

  it("adds nothing when the message is already filed here", () => {
    const decision = resolveAutoFileDecision(
      evidence({ existingLinks: [{ matterId: MATTER, state: "filed", automatic: false }] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("humanFilingDecision");
  });

  it("refuses to add a second matter to a message a person filed elsewhere", () => {
    const decision = resolveAutoFileDecision(
      evidence({ existingLinks: [{ matterId: OTHER_MATTER, state: "filed", automatic: false }] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("humanFilingDecision");
  });

  it("is untroubled by a staged link nobody has acted on yet", () => {
    const decision = resolveAutoFileDecision(
      evidence({ existingLinks: [{ matterId: MATTER, state: "staged", automatic: true }] }),
    );
    expect(decision.outcome).toBe("file");
  });
});

describe("never into a matter that is not open", () => {
  it("suspends the rule and files nothing when the matter has closed", () => {
    const decision = resolveAutoFileDecision(
      evidence({ targetMatters: [{ matterId: MATTER, status: "closed", systemOwned: false }] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("matterNotOpen");
    expect(decision.suspension).toEqual({ ruleId: THREAD_RULE, reason: "matterClosed" });
  });

  it("refuses a prospective matter", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        targetMatters: [{ matterId: MATTER, status: "prospective", systemOwned: false }],
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("matterNotOpen");
  });

  it("refuses a platform-owned matter outright, and recommends no suspension for it", () => {
    const decision = resolveAutoFileDecision(
      evidence({ targetMatters: [{ matterId: MATTER, status: "open", systemOwned: true }] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("matterNotOpen");
    expect(decision.suspension).toBeNull();
  });

  it("does not suppress an open matter", () => {
    expect(resolveAutoFileDecision(evidence()).outcome).toBe("file");
  });
});

describe("the blast bound", () => {
  it("trips at the threshold: the rule reverts to staging and asks to be suspended", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [threadRule({ firesInWindow: AUTO_FILE_MAX_FIRES_PER_WINDOW })],
      }),
    );
    expect(decision.outcome).toBe("stage");
    expect(decision.matterId).toBe(MATTER);
    expect(decision.demotionReason).toBe("blastBound");
    expect(decision.suspension).toEqual({ ruleId: THREAD_RULE, reason: "blastBound" });
    assertNoMessageContent(decision.reasons);
  });

  it("still files one below the threshold", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [threadRule({ firesInWindow: AUTO_FILE_MAX_FIRES_PER_WINDOW - 1 })],
      }),
    );
    expect(decision.outcome).toBe("file");
    expect(decision.suspension).toBeNull();
  });

  it("trips on undo rate: the firm keeps undoing the rule's filings", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [threadRule({ undosInRecentFires: AUTO_FILE_MAX_UNDOS_IN_RECENT_FIRES })],
      }),
    );
    expect(decision.outcome).toBe("stage");
    expect(decision.demotionReason).toBe("undoRate");
    expect(decision.suspension).toEqual({ ruleId: THREAD_RULE, reason: "undoRate" });
  });

  it("still files one undo below the threshold", () => {
    expect(
      resolveAutoFileDecision(
        evidence({
          matchedRules: [
            threadRule({ undosInRecentFires: AUTO_FILE_MAX_UNDOS_IN_RECENT_FIRES - 1 }),
          ],
        }),
      ).outcome,
    ).toBe("file");
  });

  it("surfaces a stage-only rule that is firing far too often, without pretending it was demoted", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [
          threadRule({ promotion: "stage", firesInWindow: AUTO_FILE_MAX_FIRES_PER_WINDOW }),
        ],
      }),
    );
    expect(decision.outcome).toBe("stage");
    expect(decision.demotionReason).toBe("rulePosture");
    expect(decision.suspension).toEqual({ ruleId: THREAD_RULE, reason: "blastBound" });
  });
});

describe("a rule that is not in service", () => {
  it("does not fire when every rule that matched is suspended", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [threadRule({ state: "suspended" })],
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("ruleNotActive");
  });

  it("does not fire on a revoked rule", () => {
    const decision = resolveAutoFileDecision(
      evidence({ matchedRules: [threadRule({ state: "revoked" })] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("ruleNotActive");
  });

  it("still fires the active rule when a suspended one matched alongside it", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [
          senderRule({ state: "suspended", matterId: OTHER_MATTER }),
          threadRule({ state: "active" }),
        ],
      }),
    );
    expect(decision.outcome).toBe("file");
    expect(decision.ruleId).toBe(THREAD_RULE);
  });
});

describe("failing closed", () => {
  const complete = evidence();
  const requiredFields = Object.keys(complete) as (keyof AutoFileEvidence)[];

  it.each(requiredFields)("decides stage or nothing — never file — with %s absent", (field) => {
    const partial = { ...complete };
    delete partial[field];
    const decision = resolveAutoFileDecision(partial as AutoFileEvidence);
    expect(decision.outcome).not.toBe("file");
  });

  it("refuses a rule handed over in a shape the guardrails cannot reason about", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [threadRule({ promotion: "always" as never })],
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("incompleteEvidence");
  });

  it("refuses when the target matter's own status was never gathered", () => {
    const decision = resolveAutoFileDecision(evidence({ targetMatters: [] }));
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("incompleteEvidence");
  });

  it("never throws on a malformed input", () => {
    expect(() => resolveAutoFileDecision(null as unknown as AutoFileEvidence)).not.toThrow();
    expect(resolveAutoFileDecision(null as unknown as AutoFileEvidence).outcome).toBe("noRule");
  });
});

describe("a signature that covered only part of the body", () => {
  // With l= the signature covers a prefix and the rest is unsigned, so a legitimately signed message
  // can be replayed with arbitrary content appended and still verify. The appended part is the
  // attacker's, which is exactly what a sender-identity rule must not file unattended.
  it("does not authenticate the sender for a correspondentMatter rule", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [senderRule()],
        threadMatterIds: [],
        dkimBodyFullyCovered: false,
      }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("senderNotAuthenticated");
  });

  it("still files the same rule when the signature covered the whole body", () => {
    const decision = resolveAutoFileDecision(
      evidence({
        matchedRules: [senderRule()],
        threadMatterIds: [],
        dkimBodyFullyCovered: true,
      }),
    );
    expect(decision.outcome).toBe("file");
  });

  // A thread rule rests on knowing a Message-ID the firm holds, not on who sent the message, so the
  // body-coverage question does not bind there.
  it("does not bind a threadContinuation rule", () => {
    const decision = resolveAutoFileDecision(evidence({ dkimBodyFullyCovered: false }));
    expect(decision.outcome).toBe("file");
  });
});

describe("a conflict hold is always stated", () => {
  // The outcome is `stage` either way; the explanation is the whole product of this function, and a
  // reader asking "why is this staged" must not be told only about the rule's posture when a conflict
  // check is also holding it.
  it("names the conflict even when another demotion won the ladder", () => {
    const decision = resolveAutoFileDecision(
      evidence({ matchedRules: [threadRule({ promotion: "stage" })], conflictHold: true }),
    );
    expect(decision.outcome).toBe("stage");
    expect(decision.demotionReason).toBe("rulePosture");
    expect(decision.reasons).toContain("A conflict check held the filing for review.");
  });

  it("does not say it twice when the conflict hold is itself the demotion", () => {
    const decision = resolveAutoFileDecision(evidence({ conflictHold: true }));
    expect(decision.demotionReason).toBe("conflictHold");
    const held = decision.reasons.filter(
      (reason) => reason === "A conflict check held the filing for review.",
    );
    expect(held).toHaveLength(1);
  });

  it("says nothing about a conflict when there is none", () => {
    const decision = resolveAutoFileDecision(evidence({ conflictHold: false }));
    expect(decision.reasons).not.toContain("A conflict check held the filing for review.");
  });
});

describe("malformed evidence in the deciding sets", () => {
  // The ambiguity guardrail refuses when the deciding evidence names more than one matter. Dropping a
  // malformed entry would SHRINK that set, so a thread genuinely resolving to two matters — one of
  // them malformed — would fire on the survivor. Unevaluable is not permission.
  it("refuses a malformed thread matter id rather than skipping it", () => {
    const decision = resolveAutoFileDecision(
      evidence({ threadMatterIds: [MATTER, ""] as unknown as readonly string[] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("incompleteEvidence");
  });

  it("refuses a non-string subject matter id rather than skipping it", () => {
    const decision = resolveAutoFileDecision(
      evidence({ subjectMatterIds: [null] as unknown as readonly string[] }),
    );
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("incompleteEvidence");
  });

  it("would otherwise have fired on the surviving matter", () => {
    // The same evidence with both ids well-formed is the ambiguity case, which is what the malformed
    // entry must not be allowed to collapse into a single-matter firing.
    const decision = resolveAutoFileDecision(evidence({ threadMatterIds: [MATTER, OTHER_MATTER] }));
    expect(decision.suppressionReason).toBe("ambiguousEvidence");
  });
});
