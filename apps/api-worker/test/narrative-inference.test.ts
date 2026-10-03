import { describe, expect, it } from "vitest";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  ConversationInput,
  EmbedInput,
  EmbeddingResult,
  GenerateInput,
  GenerateResult,
  InferencePort,
  StreamResult,
  TranscribeInput,
  TranscriptionResult,
} from "@magna-carta/inference/port";
import type { Dispatch } from "@magna-carta/integrations/dispatch";
import {
  buildInferenceJobIdempotencyKey,
  suggestNarrative,
  type NarrativeSuggestionInput,
} from "../src/timekeeping/narrative-inference.ts";

// A firm-database stub returning the stored aiProcessingEligibility value (or none for the default).
function fakeFirmDatabase(eligibility?: boolean) {
  return {
    prepare(_sql: string) {
      return {
        bind() {
          return this;
        },
        async all<T>() {
          return {
            results: (eligibility === undefined
              ? []
              : [{ value: JSON.stringify(eligibility) }]) as T[],
          };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  } as unknown as SqlDatabase;
}

// A port that records every call so the test can prove the model is NEVER reached when the gate is off.
function recordingPort(calls: GenerateInput[]): InferencePort {
  const reached = async (input: GenerateInput): Promise<Dispatch<never>> => {
    calls.push(input);
    throw new Error("the model must not be reached when the gate is off");
  };
  return {
    generate: reached,
    generateStream: async (input: GenerateInput): Promise<Dispatch<StreamResult>> => {
      calls.push(input);
      throw new Error("generateStream must not be reached when the gate is off");
    },
    generateDurable: reached,
    generateConversation: async (input: ConversationInput): Promise<Dispatch<GenerateResult>> => {
      calls.push(input as unknown as GenerateInput);
      throw new Error("generateConversation must not be reached when the gate is off");
    },
    embed: async (input: EmbedInput): Promise<Dispatch<EmbeddingResult>> => {
      calls.push(input as unknown as GenerateInput);
      throw new Error("embed must not be reached when the gate is off");
    },
    transcribe: async (input: TranscribeInput): Promise<Dispatch<TranscriptionResult>> => {
      calls.push(input as unknown as GenerateInput);
      throw new Error("transcribe must not be reached when the gate is off");
    },
  };
}

const INPUT: NarrativeSuggestionInput = {
  firmId: "firm_abc",
  matterId: "matter_xyz",
  utbmsContext: "L120",
  userHistorySeed: "drafted demand letter; reviewed discovery",
};

describe("suggestNarrative — dark until the firm's AI-processing gate is on", () => {
  it("returns a typed feature-disabled result and reaches NO model when eligibility is the default (off)", async () => {
    const calls: GenerateInput[] = [];
    const result = await suggestNarrative(fakeFirmDatabase(), recordingPort(calls), {
      modelId: "anthropic/claude-opus-4-8",
      input: INPUT,
    });
    expect(result).toEqual({ status: "feature-disabled" });
    expect(calls).toEqual([]);
  });

  it("still returns feature-disabled (no model) when eligibility is explicitly false", async () => {
    const calls: GenerateInput[] = [];
    const result = await suggestNarrative(fakeFirmDatabase(false), recordingPort(calls), {
      modelId: "anthropic/claude-opus-4-8",
      input: INPUT,
    });
    expect(result.status).toBe("feature-disabled");
    expect(calls).toEqual([]);
  });
});

describe("buildInferenceJobIdempotencyKey — stable per (firmId, matterId, prompt fingerprint)", () => {
  it("is identical for identical inputs and differs when any dimension changes", async () => {
    const key = await buildInferenceJobIdempotencyKey(INPUT);
    expect(await buildInferenceJobIdempotencyKey({ ...INPUT })).toBe(key);
    expect(await buildInferenceJobIdempotencyKey({ ...INPUT, matterId: "matter_other" })).not.toBe(
      key,
    );
    expect(await buildInferenceJobIdempotencyKey({ ...INPUT, firmId: "firm_other" })).not.toBe(key);
    expect(await buildInferenceJobIdempotencyKey({ ...INPUT, utbmsContext: "L130" })).not.toBe(key);
    expect(
      await buildInferenceJobIdempotencyKey({ ...INPUT, userHistorySeed: "different seed" }),
    ).not.toBe(key);
    // Collision-proof: inputs that share the same concatenated bytes under a space separator but differ
    // in field boundaries must produce distinct keys. The NUL (\x00) delimiter guarantees this.
    const splitA = await buildInferenceJobIdempotencyKey({
      ...INPUT,
      utbmsContext: "L120",
      userHistorySeed: "draft demand",
    });
    const splitB = await buildInferenceJobIdempotencyKey({
      ...INPUT,
      utbmsContext: "L120 draft",
      userHistorySeed: "demand",
    });
    expect(splitA).not.toBe(splitB);
  });

  it("is a stable, opaque, URL-safe token (a hex digest), not the raw prompt", async () => {
    const key = await buildInferenceJobIdempotencyKey(INPUT);
    expect(key).toMatch(/^narrative:[0-9a-f]{64}$/);
    expect(key).not.toContain("demand letter");
  });
});
