import { describe, expect, it } from "vitest";
import type { AiDetectionUsageId } from "@magna-carta/identifiers/types";
import {
  recordAiDetectionUsageStatement,
  readAiDetectionUsage,
} from "../src/ai-detection-usage-statements.ts";
import { captured, stubD1 } from "./support/stub-d1.ts";

describe("recordAiDetectionUsageStatement", () => {
  it("composes an insert targeting ai_detection_usage and binds the row fields in order", () => {
    const stub = stubD1();
    const statement = captured(
      recordAiDetectionUsageStatement(stub.database, {
        id: "aiDetectionUsage_test0000000000000" as AiDetectionUsageId,
        requestedBy: "user_x",
        wordCount: 1500,
        mode: "realtime",
        costMinor: 8,
        adapterId: "pangram",
        vendorVersion: "v3",
        resultBand: "likely",
        matterId: null,
        createdAt: "2026-07-02T00:00:00.000Z",
      }),
    );
    expect(statement.sql).toContain("INSERT INTO ai_detection_usage");
    expect(statement.bindings).toEqual([
      "aiDetectionUsage_test0000000000000",
      "user_x",
      1500,
      "realtime",
      8,
      "pangram",
      "v3",
      "likely",
      null,
      "2026-07-02T00:00:00.000Z",
    ]);
  });
});

describe("readAiDetectionUsage", () => {
  it("maps the summary row's aliased columns to the summary shape", async () => {
    const stub = stubD1();
    stub.onAll("FROM ai_detection_usage", [{ requests: 1, words: 1500, cost: 8 }]);
    expect(await readAiDetectionUsage(stub.database)).toEqual({
      totalRequests: 1,
      totalWords: 1500,
      totalCostMinor: 8,
    });
  });

  it("defaults to zeroes when the table is empty", async () => {
    const stub = stubD1();
    stub.onAll("FROM ai_detection_usage", [{ requests: 0, words: 0, cost: 0 }]);
    expect(await readAiDetectionUsage(stub.database)).toEqual({
      totalRequests: 0,
      totalWords: 0,
      totalCostMinor: 0,
    });
  });
});
