import { describe, expect, it } from "vitest";
import {
  firmRateGate,
  inferenceJobDedupKey,
  tokenUsageKeyForDay,
  type InferenceJob,
} from "../src/background/inference/inference-consumer.ts";

describe("firmRateGate (the back-pressure seam)", () => {
  it("is a pass-through no-op at launch — never throws, returns nothing", () => {
    expect(firmRateGate("firm_anything")).toBeUndefined();
  });
});

describe("tokenUsageKeyForDay", () => {
  it("buckets a run by UTC civil date + slot + model id", () => {
    const key = tokenUsageKeyForDay(
      "2026-06-18T13:45:00.000Z",
      "reasoning",
      "anthropic/claude-opus-5-5",
    );
    expect(key).toEqual({
      day: "2026-06-18",
      slot: "reasoning",
      modelId: "anthropic/claude-opus-5-5",
    });
  });
});

describe("InferenceJob carries a producer-set idempotency key", () => {
  it("the job shape exposes idempotencyKey (the producer's stable per-run anchor)", () => {
    const job: InferenceJob = {
      firmId: "firm_abc",
      databaseIdentifier: "DB_FIRM_POOL_1",
      prompt: "draft a narrative",
      idempotencyKey: "narrative:deadbeef",
    };
    expect(job.idempotencyKey).toBe("narrative:deadbeef");
  });
});

describe("inferenceJobDedupKey", () => {
  it("derives the per-run dedup record key from the job's producer key", () => {
    expect(inferenceJobDedupKey("narrative:deadbeef")).toBe("inference:narrative:deadbeef");
  });
});
