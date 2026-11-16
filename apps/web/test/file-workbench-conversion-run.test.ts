import { describe, expect, it } from "vitest";
import { ApiCallFailed } from "$lib/api/api-client.ts";
import {
  POLL_LIMIT,
  convertedName,
  runConversion,
  type ConversionPorts,
  type ConversionState,
} from "$lib/tools/file-workbench/conversion-run.ts";
import {
  DEFAULT_CHOICES,
  anySettingsFor,
  optionsFromChoices,
  settingsFor,
} from "$lib/tools/file-workbench/conversion-options.ts";

function portsWith(
  states: ConversionState[],
  overrides: Partial<ConversionPorts> = {},
): ConversionPorts & {
  submitted: unknown[];
} {
  const submitted: unknown[] = [];
  let index = 0;
  return {
    submitted,
    slot: async () => ({
      jobId: "job-1",
      uploadUrl: "https://storage/put",
      uploadHeaders: {},
      sourceKey: "k",
    }),
    putBytes: async () => {},
    submit: async (body) => {
      submitted.push(body);
    },
    state: async () => states[Math.min(index++, states.length - 1)]!,
    fetchResult: async () => new Blob(["converted"], { type: "application/pdf" }),
    wait: async () => {},
    ...overrides,
  };
}

const bytes = new Uint8Array([1, 2, 3]);

describe("runConversion", () => {
  it("uploads, submits the two formats, polls, and returns the copy", async () => {
    const stages: string[] = [];
    const ports = portsWith([
      { status: "queued" },
      { status: "running" },
      { status: "done", url: "https://r", mediaType: "application/pdf" },
    ]);
    const outcome = await runConversion(ports, bytes, "docx", "pdf", (stage) => stages.push(stage));
    expect(outcome.kind).toBe("converted");
    expect(ports.submitted).toEqual([{ jobId: "job-1", sourceKey: "k", from: "docx", to: "pdf" }]);
    expect(stages).toEqual(["uploading", "queued", "converting"]);
  });

  it("carries the engine's reason for a failed job", async () => {
    const outcome = await runConversion(
      portsWith([{ status: "failed", reason: "The file is encrypted." }]),
      bytes,
      "docx",
      "pdf",
    );
    expect(outcome).toEqual({ kind: "failed", message: "The file is encrypted." });
  });

  it("says when the result was cleared before it was fetched", async () => {
    const outcome = await runConversion(portsWith([{ status: "expired" }]), bytes, "docx", "pdf");
    expect(outcome.kind).toBe("failed");
  });

  it("names a refused format pair in words", async () => {
    const refusal = new ApiCallFailed({
      problem: { type: "unsupported-conversion", title: "Conversion not supported", status: 422 },
      request: "POST /api/v1/conversions",
      failedAt: new Date(),
    } as never);
    const outcome = await runConversion(
      portsWith([], { submit: async () => Promise.reject(refusal) }),
      bytes,
      "png",
      "docx",
    );
    expect(outcome).toEqual({
      kind: "failed",
      message: "There is no way to convert between these two formats.",
    });
  });

  it("submits the options chosen, and none when nothing was chosen", async () => {
    const done: ConversionState[] = [{ status: "done", url: "https://r", mediaType: "image/jpeg" }];
    const withOptions = portsWith(done);
    await runConversion(withOptions, bytes, "png", "jpeg", undefined, {
      maxDimension: 1600,
      quality: 60,
      grayscale: true,
    });
    expect(withOptions.submitted).toEqual([
      {
        jobId: "job-1",
        sourceKey: "k",
        from: "png",
        to: "jpeg",
        options: { maxDimension: 1600, quality: 60, grayscale: true },
      },
    ]);

    const empty = portsWith(done);
    await runConversion(empty, bytes, "png", "jpeg", undefined, { grayscale: false });
    expect(empty.submitted).toEqual([{ jobId: "job-1", sourceKey: "k", from: "png", to: "jpeg" }]);
  });

  it("names a refused setting apart from a refused format pair", async () => {
    const refusal = new ApiCallFailed({
      problem: {
        type: "https://api.example/problems/unsupported-conversion-option",
        title: "Conversion option not supported",
        status: 422,
      },
      request: "POST /api/v1/conversions",
      failedAt: new Date(),
    } as never);
    const outcome = await runConversion(
      portsWith([], { submit: async () => Promise.reject(refusal) }),
      bytes,
      "png",
      "webp",
      undefined,
      { quality: 50 },
    );
    expect(outcome).toEqual({
      kind: "failed",
      message: "This format can't take one of the settings chosen. Convert without it.",
    });
  });

  it("stops polling a job that never settles", async () => {
    let asked = 0;
    const outcome = await runConversion(
      portsWith([], { state: async () => (asked++, { status: "running" }) }),
      bytes,
      "docx",
      "pdf",
    );
    expect(outcome.kind).toBe("failed");
    expect(asked).toBe(POLL_LIMIT);
  });
});

describe("convertedName", () => {
  it("keeps the stem and takes the new extension", () => {
    expect(convertedName("Engagement Letter.docx", { extensions: ["pdf"] })).toBe(
      "Engagement Letter.pdf",
    );
  });

  it("marks a copy that would carry the original's own name", () => {
    expect(convertedName("scan.pdf", { extensions: ["pdf"] })).toBe("scan (converted).pdf");
  });
});

describe("Convert With Options settings", () => {
  it("offers size, grayscale and quality for a JPEG, and size and grayscale for image to PDF", () => {
    expect(settingsFor(["png"], "jpeg")).toEqual(["maxDimension", "quality", "grayscale"]);
    expect(settingsFor(["png"], "pdf")).toEqual(["maxDimension", "grayscale"]);
    expect(settingsFor(["docx"], "pdf")).toEqual([]);
  });

  it("offers only what every file in a set accepts", () => {
    expect(settingsFor(["png", "webp"], "jpeg")).toEqual(["maxDimension", "quality", "grayscale"]);
    expect(settingsFor(["png", "docx"], "pdf")).toEqual([]);
    expect(settingsFor([], "pdf")).toEqual([]);
    expect(anySettingsFor(["docx"], ["pdf", "odt"])).toBe(false);
    expect(anySettingsFor(["png"], ["webp", "pdf"])).toBe(true);
  });

  it("sends only accepted settings that differ from a plain conversion", () => {
    expect(optionsFromChoices(DEFAULT_CHOICES, ["maxDimension", "grayscale"])).toBeUndefined();
    expect(
      optionsFromChoices({ size: "1200", quality: 40, grayscale: true }, [
        "maxDimension",
        "grayscale",
      ]),
    ).toEqual({ maxDimension: 1200, grayscale: true });
    // The quality slider always holds a value, so a JPEG target always sends one.
    expect(optionsFromChoices(DEFAULT_CHOICES, ["maxDimension", "quality", "grayscale"])).toEqual({
      quality: 75,
    });
    expect(optionsFromChoices({ size: "800", quality: 40, grayscale: true }, [])).toBeUndefined();
  });
});
