import { describe, expect, it } from "vitest";
import type { DetectionInput } from "../src/port.ts";
import { deferredAiDetectionAdapter } from "../src/adapters/deferred.ts";

const INPUT: DetectionInput = {
  text: "a".repeat(400),
  firmId: "firm_test" as DetectionInput["firmId"],
};

describe("deferred ai-detection adapter", () => {
  it("declares no supported operations", () => {
    expect(deferredAiDetectionAdapter.descriptor.operations.detect?.supported).toBe(false);
  });

  it("detect returns capability-unsupported and never throws", async () => {
    const port = deferredAiDetectionAdapter.create({});
    const result = await port.detect(INPUT);
    expect(result).toEqual({ ok: false, reason: "capability-unsupported" });
  });
});
