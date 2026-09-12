import { describe, expect, it } from "vitest";
import type { FileScanEvent } from "../src/lib/file-manager/matter-file-api.ts";
import {
  requestIsOpen,
  scanEventEngineText,
  scanEventVerdictText,
} from "../src/lib/file-manager/scan-history-model.ts";

function event(overrides: Partial<FileScanEvent>): FileScanEvent {
  return {
    id: "e",
    at: "2026-01-01T00:00:00.000Z",
    event: "file.version_committed",
    versionId: "v1",
    versionNumber: 1,
    actorUserId: null,
    actorName: null,
    scanVerdict: "clean",
    scanEngineVersion: "clamav/1.0",
    scanDetail: null,
    ...overrides,
  };
}

describe("a file's scan history, line by line", () => {
  it("reads a scan by what it found and a request by who asked", () => {
    // The register's own words: the Safety column's, so a line and the column never disagree.
    expect(scanEventVerdictText(event({}))).toBe("Clean");
    expect(scanEventVerdictText(event({ scanVerdict: "flagged" }))).toBe("Error");
    expect(scanEventVerdictText(event({ event: "file.quarantined" }))).toBe("Held");
    expect(scanEventVerdictText(event({ scanVerdict: null }))).toBe("Not recorded");
    expect(
      scanEventVerdictText(event({ event: "file.rescan_requested", actorName: "A. Lawyer" })),
    ).toBe("Requested by A. Lawyer");
    expect(scanEventEngineText(event({ scanEngineVersion: null }))).toBe("No engine");
    expect(scanEventEngineText(event({ event: "file.rescan_requested" }))).toBe("");
  });

  it("keeps a request open until a scan of the same version lands after it", () => {
    const request = event({
      id: "r",
      event: "file.rescan_requested",
      at: "2026-01-02T00:00:00.000Z",
    });
    const earlier = event({ id: "c", at: "2026-01-01T00:00:00.000Z" });
    expect(requestIsOpen([request, earlier], request)).toBe(true);
    const answer = event({
      id: "a",
      event: "file.version_rescanned",
      at: "2026-01-02T00:00:05.000Z",
    });
    expect(requestIsOpen([answer, request, earlier], request)).toBe(false);
    // A scan of ANOTHER version answers nothing here.
    const other = event({ id: "o", versionId: "v2", at: "2026-01-02T00:00:05.000Z" });
    expect(requestIsOpen([other, request, earlier], request)).toBe(true);
  });
});
