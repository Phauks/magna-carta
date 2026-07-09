import { describe, expect, it } from "vitest";
import {
  parsePangramResponse,
  parsePangramSubmit,
  parsePangramTaskStatus,
} from "../src/adapters/pangram-response.ts";

describe("parsePangramResponse", () => {
  it("accepts a well-formed prediction and preserves optional fields", () => {
    const parsed = parsePangramResponse({
      fraction_ai: 0.92,
      fraction_ai_assisted: 0.1,
      version: "v3",
      stage: "production",
      windows: [{ start_index: 0, end_index: 40, ai_assistance_score: 0.9, confidence: 0.8 }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.fraction_ai).toBe(0.92);
    expect(parsed?.windows?.[0]?.end_index).toBe(40);
  });

  it("accepts the minimal shape (only fraction_ai)", () => {
    expect(parsePangramResponse({ fraction_ai: 0.1 })).toEqual({ fraction_ai: 0.1 });
  });

  it("returns null when fraction_ai is missing or non-numeric", () => {
    expect(parsePangramResponse({})).toBeNull();
    expect(parsePangramResponse({ fraction_ai: "0.5" })).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(parsePangramResponse(null)).toBeNull();
    expect(parsePangramResponse("nope")).toBeNull();
  });

  it("rejects a malformed window rather than dropping it", () => {
    expect(parsePangramResponse({ fraction_ai: 0.5, windows: [{ start_index: 0 }] })).toBeNull();
  });

  it("rejects a fraction_ai outside [0, 1] (a probability the vendor should never emit)", () => {
    expect(parsePangramResponse({ fraction_ai: 5 })).toBeNull();
    expect(parsePangramResponse({ fraction_ai: -0.1 })).toBeNull();
    expect(parsePangramResponse({ fraction_ai: Number.NaN })).toBeNull();
    expect(parsePangramResponse({ fraction_ai: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("rejects out-of-range optional and per-window probabilities", () => {
    expect(parsePangramResponse({ fraction_ai: 0.5, fraction_ai_assisted: 2 })).toBeNull();
    expect(
      parsePangramResponse({
        fraction_ai: 0.5,
        windows: [{ start_index: 0, end_index: 10, ai_assistance_score: 1.5 }],
      }),
    ).toBeNull();
    expect(
      parsePangramResponse({
        fraction_ai: 0.5,
        windows: [{ start_index: 0, end_index: 10, ai_assistance_score: 0.9, confidence: 9 }],
      }),
    ).toBeNull();
  });
});

describe("parsePangramSubmit", () => {
  it("reads task_id from the async submit response", () => {
    expect(parsePangramSubmit({ task_id: "abc123" })).toEqual({ taskId: "abc123" });
  });
  it("returns null when task_id is missing or non-string", () => {
    expect(parsePangramSubmit({})).toBeNull();
    expect(parsePangramSubmit({ task_id: 5 })).toBeNull();
    expect(parsePangramSubmit(null)).toBeNull();
  });
  it("returns null when task_id is an empty string", () => {
    expect(parsePangramSubmit({ task_id: "" })).toBeNull();
  });
});

describe("parsePangramTaskStatus", () => {
  it("returns success with the prediction when stage is STAGE_SUCCESS and the body is valid", () => {
    const status = parsePangramTaskStatus({
      stage: "STAGE_SUCCESS",
      fraction_ai: 0.9,
      version: "3.3",
    });
    expect(status.kind).toBe("success");
    if (status.kind !== "success") return;
    expect(status.prediction.fraction_ai).toBe(0.9);
    expect(status.prediction.version).toBe("3.3");
  });
  it("returns failed when stage is STAGE_FAILED", () => {
    expect(parsePangramTaskStatus({ stage: "STAGE_FAILED" }).kind).toBe("failed");
  });
  it("returns pending for a non-terminal or absent stage", () => {
    expect(parsePangramTaskStatus({ stage: "STAGE_PROCESSING" }).kind).toBe("pending");
    expect(parsePangramTaskStatus({}).kind).toBe("pending");
  });
  it("returns malformed for a non-object, or STAGE_SUCCESS with an invalid prediction", () => {
    expect(parsePangramTaskStatus(null).kind).toBe("malformed");
    expect(parsePangramTaskStatus("nope").kind).toBe("malformed");
    expect(parsePangramTaskStatus({ stage: "STAGE_SUCCESS", fraction_ai: 5 }).kind).toBe(
      "malformed",
    );
    expect(parsePangramTaskStatus({ stage: "STAGE_SUCCESS" }).kind).toBe("malformed");
  });
});
