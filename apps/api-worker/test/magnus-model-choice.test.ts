import { describe, expect, it } from "vitest";
import {
  answeringModelBody,
  modelChoiceForRun,
  resolveModelChoice,
} from "../src/magnus/model-choice.ts";
import { magnusTurnJobFrom, parseMagnusTurnSubmittedPayload } from "../src/magnus/turn-relay.ts";

const FIRM_MODEL = "anthropic/claude-opus-5-5";

describe("a member's choice of model and effort", () => {
  it("is the firm's model at its default effort when the member chose nothing", () => {
    expect(resolveModelChoice(FIRM_MODEL, {})).toEqual({
      kind: "ok",
      choice: { modelId: FIRM_MODEL, effort: "medium" },
    });
  });

  it("takes another model on the roster, at its own default when no effort is named", () => {
    expect(resolveModelChoice(FIRM_MODEL, { modelId: "anthropic/claude-sonnet-5-5" })).toEqual({
      kind: "ok",
      choice: { modelId: "anthropic/claude-sonnet-5-5", effort: "high" },
    });
  });

  it("refuses a model off the roster, the platform's own model among them", () => {
    expect(resolveModelChoice(FIRM_MODEL, { modelId: "@cf/openai/gpt-oss-120b" }).kind).toBe(
      "unknown-model",
    );
    expect(resolveModelChoice(FIRM_MODEL, { modelId: "anthropic/claude-fable-5" }).kind).toBe(
      "unknown-model",
    );
  });

  it("refuses an effort the model does not take", () => {
    expect(resolveModelChoice(FIRM_MODEL, { effort: "extreme" }).kind).toBe("unsupported-effort");
  });

  it("answers a job whose choice no longer resolves with the firm's model, never failing it", () => {
    expect(modelChoiceForRun(FIRM_MODEL, { modelId: "anthropic/retired", effort: "max" })).toEqual({
      modelId: FIRM_MODEL,
      effort: "medium",
    });
    expect(modelChoiceForRun(FIRM_MODEL, { effort: "extreme" })).toEqual({
      modelId: FIRM_MODEL,
      effort: "medium",
    });
  });

  it("reports a model's name and its effort levels for the composer", () => {
    expect(answeringModelBody(FIRM_MODEL)).toMatchObject({
      displayName: "Claude Opus 5.5",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
    });
    expect(answeringModelBody("anthropic/retired")).toBeNull();
  });

  it("rides the outbox payload to the queue job, and a malformed one is dropped", () => {
    const base = { conversationId: "c", magnusTurnId: "t", memberTurnId: "m" };
    const chosen = parseMagnusTurnSubmittedPayload(
      JSON.stringify({ ...base, modelId: FIRM_MODEL, effort: "high" }),
    );
    expect(chosen).not.toBeNull();
    if (chosen === null) return;
    expect(magnusTurnJobFrom("firm", "outbox", chosen)).toMatchObject({
      modelId: FIRM_MODEL,
      effort: "high",
    });
    const malformed = parseMagnusTurnSubmittedPayload(JSON.stringify({ ...base, modelId: 7 }));
    expect(malformed).toEqual(base);
  });
});
