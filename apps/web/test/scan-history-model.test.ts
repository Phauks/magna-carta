import { describe, expect, it } from "vitest";
import type { FileScanEvent } from "../src/lib/file-manager/matter-file-api.ts";
import {
  requestIsOpen,
  scanEventDetailReading,
  scanEventEngineText,
  scanEventVerdictText,
  scanRequestWasNotQueued,
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
    queued: null,
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
    // A request carries the engine that stood for the firm when it was asked — the fact that
    // decided whether a check could be queued at all — so the column states it rather than blank.
    expect(scanEventEngineText(event({ event: "file.rescan_requested" }))).toBe("clamav/1.0");
    expect(
      scanEventEngineText(event({ event: "file.rescan_requested", scanEngineVersion: null })),
    ).toBe("No engine");
  });

  it("says when a request never reached the engine, and why", () => {
    // Recorded and never queued: without this the line reads as a check on its way, and the
    // reader waits for a verdict that was never going to arrive.
    const noEngine = event({
      event: "file.rescan_requested",
      actorName: "A. Lawyer",
      scanEngineVersion: null,
      queued: false,
    });
    expect(scanRequestWasNotQueued(noEngine)).toBe(true);
    expect(scanEventVerdictText(noEngine)).toBe("Not queued");
    expect(scanEventDetailReading(noEngine)).toEqual({
      text: "No scan engine was reporting, so no check could be queued.",
      verbatim: false,
    });
    // An engine WAS recorded, so the fault was elsewhere and the line does not blame the engine.
    const otherFault = event({ event: "file.rescan_requested", queued: false });
    expect(scanEventDetailReading(otherFault).text).toBe(
      "The check could not be queued. Nothing ran.",
    );
    // A request that WAS queued reads as it always did.
    const queued = event({ event: "file.rescan_requested", actorName: "A. Lawyer", queued: true });
    expect(scanRequestWasNotQueued(queued)).toBe(false);
    expect(scanEventVerdictText(queued)).toBe("Requested by A. Lawyer");
    // An older row recorded nothing about queuing, and must not be reported as a failure.
    expect(scanRequestWasNotQueued(event({ event: "file.rescan_requested" }))).toBe(false);
  });

  it("states the platform's own detail codes in words and leaves the engine's alone", () => {
    expect(scanEventDetailReading(event({ scanDetail: "active-content" }))).toEqual({
      text: "Holds active content: macros or embedded scripts.",
      verbatim: false,
    });
    expect(scanEventDetailReading(event({ scanDetail: "encrypted" })).verbatim).toBe(false);
    // A rule id or a signature name is the engine's own words and stands exactly as recorded.
    expect(scanEventDetailReading(event({ scanDetail: "Win.Trojan.Agent-1234" }))).toEqual({
      text: "Win.Trojan.Agent-1234",
      verbatim: true,
    });
    expect(scanEventDetailReading(event({ scanDetail: null })).text).toBe("");
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
