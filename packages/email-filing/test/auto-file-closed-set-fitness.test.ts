import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeAutoFileDecisionRecord,
  resolveAutoFileDecision,
  type AutoFileEvidence,
  type AutoFileRuleKind,
} from "../src/auto-file-rules.ts";

// The auto-file rule vocabulary lives in FOUR places by design, and they have to agree or the
// disagreement is silent: the TypeScript unions here, the CHECK constraints on the per-firm tables,
// the structurally-identical unions the data-access layer declares so it can stay a foundational
// layer, and the enums the API surface validates against. Four homes is the price of those layers
// not depending on each other; this sweep is what makes the price safe to pay.
//
// The failure this catches is a fourth rule kind — or a ninth suppression reason — added in one
// place. A kind the schema accepts and the guardrails have never heard of is a rule that can be
// stored and then decided over by a `switch` with no arm for it.

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const engineSource = sourceOf("../src/auto-file-rules.ts");
const fullSchemaSource = sourceOf("../../database/src/per-firm-schema.ts");
// Only the two auto-file tables. The whole schema declares dozens of columns literally named `kind`,
// and a sweep that read the first one would be reporting on postal addresses.
const schemaSource = sliceBetween(
  fullSchemaSource,
  "export const emailAutoFileRule = sqliteTable(",
  "// -----",
);
const dataAccessSource = sourceOf("../../data-access/src/email-auto-file-statements.ts");
const routeSource = sourceOf("../../../apps/api-worker/src/routes/email/auto-file-rules.ts");

// Pull a quoted string list out of a source file by a locating substring, so the sweep reads the real
// declarations rather than a copy of them kept up to date by hand.
// The region of a file between a starting anchor and the next occurrence of a terminator.
function sliceBetween(source: string, anchor: string, terminator: string): string {
  const start = source.indexOf(anchor);
  if (start < 0) throw new Error(`anchor not found: ${anchor}`);
  const end = source.indexOf(terminator, start + anchor.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function quotedValuesAfter(source: string, anchor: string, closing: string): string[] {
  const start = source.indexOf(anchor);
  expect(start, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const end = source.indexOf(closing, start + anchor.length);
  expect(end, `closing not found after: ${anchor}`).toBeGreaterThan(-1);
  const segment = source.slice(start + anchor.length, end);
  return [...segment.matchAll(/"([a-zA-Z]+)"|'([a-zA-Z]+)'/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

const KNOWN_KINDS = ["threadContinuation", "correspondentMatter"] as const;

describe("the rule-kind set is closed, and every home agrees on it", () => {
  it("is exactly two kinds in the engine's union", () => {
    expect(quotedValuesAfter(engineSource, "export type AutoFileRuleKind =", ";")).toEqual([
      ...KNOWN_KINDS,
    ]);
  });

  it("is the same two in the schema's column enum and its CHECK constraint", () => {
    expect(
      quotedValuesAfter(schemaSource, 'kind: text("kind", { enum: [', "] }).notNull()"),
    ).toEqual([...KNOWN_KINDS]);
    expect(quotedValuesAfter(schemaSource, '"email_auto_file_rule_kind_check",', "),")).toEqual([
      ...KNOWN_KINDS,
    ]);
  });

  it("is the same two in the data-access layer's own declaration", () => {
    expect(quotedValuesAfter(dataAccessSource, "export type AutoFileRuleKind =", ";")).toEqual([
      ...KNOWN_KINDS,
    ]);
  });

  it("is the same two in the API surface's request and response enum", () => {
    expect(quotedValuesAfter(routeSource, "const RuleKind = z.enum([", "]);")).toEqual([
      ...KNOWN_KINDS,
    ]);
  });

  // The guardrail function has to have an ANSWER for every kind, not merely a type that admits it.
  // A kind with no phrasing renders a decision with no sentence explaining it, which is the whole
  // product of the read that explains an automatic filing.
  it("has a rendered sentence for every kind", () => {
    for (const kind of KNOWN_KINDS) {
      expect(
        describeAutoFileDecisionRecord({
          outcome: "staged",
          suppressionReason: null,
          demotionReason: null,
          ruleKind: kind,
        }),
      ).toHaveLength(1);
    }
  });

  // An unrecognized kind is not a crash and not an invented sentence. A rolling deploy can hand this
  // build a ledger row written by one that knew a value it does not.
  it("renders nothing for a value this build does not know, and does not throw", () => {
    expect(
      describeAutoFileDecisionRecord({
        outcome: "suppressed",
        suppressionReason: "aReasonFromTheFuture",
        demotionReason: "constructor",
        ruleKind: "toString",
      }),
    ).toEqual([]);
  });
});

describe("the suppression and demotion vocabularies agree across their homes", () => {
  const SUPPRESSION_REASONS = [
    "ambiguousEvidence",
    "creatorAccessWithdrawn",
    "senderNotAuthenticated",
    "signatureFailed",
    "humanFilingDecision",
    "matterNotOpen",
    "ruleNotActive",
    "incompleteEvidence",
  ];

  it("is the same closed set in the schema column, the CHECK, and the data-access declaration", () => {
    expect(
      quotedValuesAfter(schemaSource, 'suppressionReason: text("suppression_reason", {', "}),"),
    ).toEqual(SUPPRESSION_REASONS);
    expect(
      quotedValuesAfter(schemaSource, '"email_auto_file_decision_suppression_reason_check",', "),"),
    ).toEqual(SUPPRESSION_REASONS);
    expect(
      quotedValuesAfter(dataAccessSource, "export type AutoFileDecisionSuppressionReason =", ";"),
    ).toEqual(SUPPRESSION_REASONS);
  });

  it("has a rendered sentence for every suppression reason", () => {
    for (const reason of SUPPRESSION_REASONS) {
      expect(
        describeAutoFileDecisionRecord({
          outcome: "suppressed",
          suppressionReason: reason,
          demotionReason: null,
          ruleKind: null,
        }),
      ).toHaveLength(1);
    }
  });

  it("has a rendered sentence for every reason a firing can be demoted to staging", () => {
    for (const reason of [
      "rulePosture",
      "firmPolicyDirectFilingOff",
      "conflictHold",
      "blastBound",
      "undoRate",
    ]) {
      expect(
        describeAutoFileDecisionRecord({
          outcome: "staged",
          suppressionReason: null,
          demotionReason: reason,
          ruleKind: "threadContinuation",
        }),
      ).toHaveLength(2);
    }
  });
});

describe("nothing rendered from a decision can carry message content", () => {
  // The ledger holds identifiers and enums, and the sentences are rendered from a fixed table. That
  // makes "no message content in the explanation" a property of the phrasing rather than of the
  // caller's care — so the phrasings themselves must hold no interpolation.
  it("builds no phrasing from a value at runtime", () => {
    // A template literal or a concatenation inside one of these tables is the only way a sentence
    // could come to hold a subject line or an address, so the shape is what is asserted rather than
    // the output: a table of plain double-quoted strings, with nothing interpolated into it.
    for (const table of ["SUPPRESSION_PHRASING", "DEMOTION_PHRASING", "FIRED_PHRASING"]) {
      const body = sliceBetween(engineSource, `const ${table}`, "\n};");
      expect(body, `${table} not found`).toContain(":");
      expect(body, `${table} interpolates`).not.toContain("`");
      expect(body, `${table} interpolates`).not.toContain("${");
      expect(body, `${table} concatenates`).not.toMatch(/"\s*\+/);
    }
  });

  it("renders only sentences from the table, whatever a decision names", () => {
    const rendered = describeAutoFileDecisionRecord({
      outcome: "suppressed",
      suppressionReason: "humanFilingDecision",
      demotionReason: null,
      ruleKind: "correspondentMatter" satisfies AutoFileRuleKind,
    });
    expect(rendered).toEqual([
      "A rule files mail from this sender to this matter.",
      "Somebody has already decided where this message goes.",
    ]);
  });
});

describe("the engine still fails closed with the vocabulary it does not recognize", () => {
  // A rule row whose `kind` this build has never heard of must be unevaluable, not permission. The
  // schema's CHECK makes that unreachable today; the guardrail must not be relying on it.
  it("treats a rule of an unknown kind as unevaluable", () => {
    const evidence = {
      matchedRules: [
        {
          ruleId: "emailAutoFileRule_x",
          kind: "senderDomain" as AutoFileRuleKind,
          matterId: "matter_a",
          matchValue: "opposing.test",
          promotion: "file",
          state: "active",
          creatorRetainsMatterAccess: true,
          firesInWindow: 0,
          undosInRecentFires: 0,
        },
      ],
      threadMatterIds: [],
      subjectMatterIds: [],
      existingLinks: [],
      dkimVerdict: "pass",
      capturedVia: "addin",
      dkimVerifiedDomain: "opposing.test",
      dkimBodyFullyCovered: true,
      targetMatters: [{ matterId: "matter_a", status: "open", systemOwned: false }],
      conflictHold: false,
      firmDirectFilingPermitted: true,
      circuitBreaker: { maxFiresPerWindow: 25, recentFireWindow: 10, maxUndosInRecentFires: 3 },
    } satisfies AutoFileEvidence;
    const decision = resolveAutoFileDecision(evidence);
    expect(decision.outcome).toBe("noRule");
    expect(decision.suppressionReason).toBe("incompleteEvidence");
  });
});
