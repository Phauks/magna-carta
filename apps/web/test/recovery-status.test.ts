/*
 * The recovery job status vocabulary, pinned. `active` is what the polling loop reads to decide
 * whether to keep asking — every terminal status must answer false, and the two running ones true.
 */
import { describe, expect, it } from "vitest";
import {
  formatCandidateCount,
  presentRecoveryStatus,
} from "../src/lib/tools/file-workbench/recovery-status.ts";
import type { RecoveryStatus } from "../src/lib/tools/file-workbench/decryption-api.ts";

describe("presentRecoveryStatus", () => {
  it("marks queued and running as active, and every other status as terminal", () => {
    const active: RecoveryStatus[] = ["queued", "running"];
    const terminal: RecoveryStatus[] = ["found", "exhausted", "needsGpu", "cancelled"];
    for (const status of active) {
      expect(presentRecoveryStatus(status, "cfCapable").active).toBe(true);
    }
    for (const status of terminal) {
      expect(presentRecoveryStatus(status, "cfCapable").active).toBe(false);
    }
  });

  it("tells the reader the password is shown once, on found", () => {
    const presentation = presentRecoveryStatus("found", "cfCapable");
    expect(presentation.heading).toBe("Found");
    expect(presentation.description).toContain("shown once");
  });

  it("names the hardware limitation rather than reading as a failure, on needsGpu", () => {
    const presentation = presentRecoveryStatus("needsGpu", "gpuRequired");
    expect(presentation.heading).toBe("Needs More Powerful Hardware");
    expect(presentation.description).toContain("Nothing is wrong with the file");
  });

  it("distinguishes exhausted from cancelled: one is a complete search, the other a stop", () => {
    expect(presentRecoveryStatus("exhausted", "cfCapable").description).toContain("full list");
    expect(presentRecoveryStatus("cancelled", "cfCapable").description).toContain("stopped");
  });
});

describe("formatCandidateCount", () => {
  it("pluralizes and separates thousands", () => {
    expect(formatCandidateCount(0)).toBe("0 passwords tried");
    expect(formatCandidateCount(1)).toBe("1 password tried");
    expect(formatCandidateCount(12000)).toBe("12,000 passwords tried");
  });
});
