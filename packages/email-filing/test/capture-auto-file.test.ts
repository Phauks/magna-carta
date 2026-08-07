import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureReady, parseMessage } from "@magna-carta/email";
import type {
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { AutoFileDecision } from "../src/auto-file-rules.ts";
import {
  captureEmail,
  type AutoFileEvaluationRequest,
  type CapturePorts,
  type CaptureRequest,
  type CaptureWritePlan,
} from "../src/capture.ts";

// The conflict/ethical-wall hook answers "no conflict" for every input today, so a test that wants to
// see a hold has to stand one in. Mocked at the module boundary rather than injected, because the one
// call site is the point: the capture core owns the hook, and a rule reaching `filed` past it is the
// failure this replaces.
const conflictedMatters = new Set<string>();
vi.mock("../src/seams.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/seams.ts")>();
  return {
    ...original,
    checkFilingConflict: (input: { matterId: string }) => ({
      hasConflict: conflictedMatters.has(input.matterId),
      holds: [],
    }),
  };
});

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../email/src/pkg/email_core_bg.wasm", import.meta.url)),
);
const SIMPLE_EML = new TextEncoder().encode(
  [
    "Message-ID: <auto-file@example.test>",
    "From: Opposing Counsel <counsel@opposing.test>",
    "To: Alice Attorney <alice@firm.test>",
    "Subject: Re: Retainer",
    "Date: Tue, 07 Jul 2026 10:00:00 -0700",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Replying on the retainer.",
  ].join("\r\n"),
);

const RULE_MATTER = "matter_rule_target" as MatterId;
const RULE_ID = "emailAutoFileRule_one";

function decision(overrides: Partial<AutoFileDecision> = {}): AutoFileDecision {
  return {
    outcome: "stage",
    matterId: RULE_MATTER,
    ruleId: RULE_ID,
    suppressionReason: null,
    demotionReason: "rulePosture",
    suspension: null,
    reasons: ["This conversation is already filed to this matter."],
    ...overrides,
  };
}

class Recorder {
  plans: CaptureWritePlan[] = [];
  autoFileRequests: AutoFileEvaluationRequest[] = [];
  private counter = 0;

  ports(
    resolveAutoFileDecision?: (request: AutoFileEvaluationRequest) => Promise<AutoFileDecision>,
  ): CapturePorts {
    return {
      parse: (bytes) => parseMessage(bytes),
      persistOriginal: async (bytes) => {
        const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
        const sha = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        return { originalR2Key: `emails/${sha}/original`, contentSha256: sha };
      },
      findByDedupKey: async () => null,
      findThreadIdsByMessageIds: async () => new Map<string, EmailThreadId>(),
      resolveAutoFileDecision:
        resolveAutoFileDecision === undefined
          ? undefined
          : (request) => {
              this.autoFileRequests.push(request);
              return resolveAutoFileDecision(request);
            },
      newEmailMessageId: () => `emailMessage_${(this.counter += 1)}` as EmailMessageId,
      newEmailThreadId: () => `emailThread_${(this.counter += 1)}` as EmailThreadId,
      newEmailParticipantId: () => `emailParticipant_${(this.counter += 1)}` as EmailParticipantId,
      newEmailMatterLinkId: () => `emailMatterLink_${(this.counter += 1)}` as EmailMatterLinkId,
      now: () => "2026-08-07T10:00:00.000Z",
      writeCapture: async (plan) => {
        this.plans.push(plan);
      },
    };
  }
}

function request(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    bytes: SIMPLE_EML,
    firmId: "firm_test",
    capturedVia: "forward",
    matterId: null,
    linkedBy: null,
    acceptOnCapture: false,
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureReady(wasmBytes);
});

describe("captureEmail — the auto-file port", () => {
  it("stages the rule's matter and names the rule on the link", async () => {
    const recorder = new Recorder();
    const result = await captureEmail(
      request(),
      recorder.ports(async () => decision()),
    );
    expect(result.linkState).toBe("staged");
    expect(result.matterId).toBe(RULE_MATTER);
    expect(recorder.plans[0]?.link?.state).toBe("staged");
    expect(recorder.plans[0]?.link?.autoFileRuleId).toBe(RULE_ID);
    expect(recorder.plans[0]?.autoFileDecision?.demotionReason).toBe("rulePosture");
  });

  it("files directly when the decision says file, and the link still names the rule", async () => {
    const recorder = new Recorder();
    const result = await captureEmail(
      request(),
      recorder.ports(async () => decision({ outcome: "file", demotionReason: null })),
    );
    expect(result.linkState).toBe("filed");
    expect(recorder.plans[0]?.link?.state).toBe("filed");
    expect(recorder.plans[0]?.link?.linkedAt).not.toBeNull();
    expect(recorder.plans[0]?.link?.autoFileRuleId).toBe(RULE_ID);
  });

  it("a conflict hold demotes an automatic filing to staged, exactly as it does a person's accept", async () => {
    conflictedMatters.add(RULE_MATTER);
    try {
      const recorder = new Recorder();
      const result = await captureEmail(
        request(),
        recorder.ports(async () => decision({ outcome: "file", demotionReason: null })),
      );
      expect(result.linkState).toBe("staged");
      expect(recorder.plans[0]?.link?.state).toBe("staged");
      expect(recorder.plans[0]?.link?.linkedAt).toBeNull();
    } finally {
      conflictedMatters.delete(RULE_MATTER);
    }
  });

  it("hands the gatherer the hook's real answer for a candidate matter", async () => {
    conflictedMatters.add(RULE_MATTER);
    try {
      const recorder = new Recorder();
      let held: boolean | null = null;
      await captureEmail(
        request(),
        recorder.ports(async (evaluation) => {
          held = evaluation.conflictHoldFor(RULE_MATTER);
          return decision();
        }),
      );
      expect(held).toBe(true);
    } finally {
      conflictedMatters.delete(RULE_MATTER);
    }
  });

  it("a decision of noRule leaves the capture exactly where it was — unrouted", async () => {
    const recorder = new Recorder();
    const result = await captureEmail(
      request(),
      recorder.ports(async () => decision({ outcome: "noRule", matterId: null, ruleId: null })),
    );
    expect(result.linkState).toBe("none");
    expect(result.matterId).toBeNull();
    expect(recorder.plans[0]?.link).toBeNull();
  });

  it("a gatherer that throws never costs the firm the capture", async () => {
    const recorder = new Recorder();
    const result = await captureEmail(
      request(),
      recorder.ports(() => Promise.reject(new Error("the per-firm read was unavailable"))),
    );
    expect(result.linkState).toBe("none");
    expect(result.autoFileDecision).toBeNull();
    expect(recorder.plans).toHaveLength(1); // the message itself still landed
    expect(recorder.plans[0]?.message).not.toBeNull();
  });

  it("does not consult the rules when an entrance already routed the capture", async () => {
    const recorder = new Recorder();
    const result = await captureEmail(
      request({ matterId: "matter_from_the_entrance" as MatterId }),
      recorder.ports(async () => decision({ outcome: "file" })),
    );
    expect(recorder.autoFileRequests).toHaveLength(0);
    expect(result.matterId).toBe("matter_from_the_entrance");
    expect(recorder.plans[0]?.link?.autoFileRuleId).toBeNull();
  });

  it("tells the gatherer the normalized sender and the signature facts the guardrails read", async () => {
    const recorder = new Recorder();
    await captureEmail(
      request(),
      recorder.ports(async () => decision()),
    );
    const evaluation = recorder.autoFileRequests[0];
    expect(evaluation?.fromAddress).toBe("counsel@opposing.test");
    expect(evaluation?.capturedVia).toBe("forward");
    expect(evaluation?.subject).toBe("Re: Retainer");
    // No verifier port is wired here, so the honest answer is "nobody looked" — never a pass.
    expect(evaluation?.dkimVerdict).toBe("unverified");
    expect(evaluation?.dkimVerifiedDomain).toBeNull();
    expect(evaluation?.dkimBodyFullyCovered).toBe(false);
  });

  it("carries the decision into the write plan so the ledger rides the capture's own batch", async () => {
    const recorder = new Recorder();
    await captureEmail(
      request(),
      recorder.ports(async () =>
        decision({ outcome: "noRule", suppressionReason: "ambiguousEvidence", matterId: null }),
      ),
    );
    expect(recorder.plans[0]?.autoFileDecision?.suppressionReason).toBe("ambiguousEvidence");
    expect(recorder.plans[0]?.link).toBeNull();
  });

  it("leaves every capture untouched when no port is wired", async () => {
    const recorder = new Recorder();
    const result = await captureEmail(
      request({ matterId: "matter_plain" as MatterId, acceptOnCapture: true }),
      recorder.ports(),
    );
    expect(result.linkState).toBe("filed");
    expect(result.autoFileDecision).toBeNull();
    expect(recorder.plans[0]?.link?.autoFileRuleId).toBeNull();
  });
});
