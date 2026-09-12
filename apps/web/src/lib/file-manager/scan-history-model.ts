import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import type { FileScanEvent, FileScanEventKind } from "./matter-file-api.ts";

export type ScanVerdict = FileScanEvent["scanVerdict"];

/** What happened, in the reader's words. */
export const SCAN_EVENT_LABELS: Readonly<Record<FileScanEventKind, string>> = {
  "file.version_committed": "Checked at intake",
  "file.version_rescanned": "Checked again",
  "file.quarantined": "Held",
  "file.rescan_requested": "Check requested",
};

/**
 * The register key a recorded verdict reads under — the same key the Safety column grades the
 * file by, so a history line and the column never disagree on a word or a tone. A hold reads as
 * what the firm physically did with the version; a verdict the row did not record reads as
 * nothing at all (null), and the line says "Not recorded" in plain words.
 */
export function scanEventStatusKey(event: FileScanEvent): StatusKey | null {
  if (event.event === "file.rescan_requested") return null;
  if (event.event === "file.quarantined") return "held";
  switch (event.scanVerdict) {
    case "clean":
      return "clean";
    case "flagged":
      return "error";
    case "unscanned":
      return "not-scanned";
    case null:
      return null;
  }
}

/**
 * A request line reads by who asked; a scan line reads by what it found, in the register's own
 * word. An older row written before the verdict rode on the event carries none of those facts,
 * and says so rather than borrowing the version's latest verdict.
 */
export function scanEventVerdictText(event: FileScanEvent): string {
  if (event.event === "file.rescan_requested") {
    return event.actorName === null ? "Requested" : `Requested by ${event.actorName}`;
  }
  const key = scanEventStatusKey(event);
  return key === null ? "Not recorded" : statusEntry(key).label;
}

/** The engine on the line, or the plain fact that none was recorded (a no-engine launch scan). */
export function scanEventEngineText(event: FileScanEvent): string {
  if (event.event === "file.rescan_requested") return "";
  return event.scanEngineVersion ?? "No engine";
}

/**
 * Whether a request is still unanswered: no scan event for the same version has landed after it.
 * The row the request made shows "Check requested" until the verdict row arrives beneath it — the
 * history is newest first — so an open request is the newest line for its version.
 */
export function requestIsOpen(events: readonly FileScanEvent[], request: FileScanEvent): boolean {
  if (request.event !== "file.rescan_requested") return false;
  return !events.some(
    (event) =>
      event.versionId === request.versionId &&
      event.event !== "file.rescan_requested" &&
      event.at >= request.at,
  );
}
