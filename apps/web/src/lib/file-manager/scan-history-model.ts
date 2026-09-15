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
 *
 * A request the platform could not queue says so on the line. Without it the row reads as a check
 * on its way, and the reader waits for a verdict that was never going to arrive.
 */
export function scanEventVerdictText(event: FileScanEvent): string {
  if (event.event === "file.rescan_requested") {
    if (event.queued === false) return "Not queued";
    return event.actorName === null ? "Requested" : `Requested by ${event.actorName}`;
  }
  const key = scanEventStatusKey(event);
  return key === null ? "Not recorded" : statusEntry(key).label;
}

/** Whether a request line reports a check that never reached the engine. */
export function scanRequestWasNotQueued(event: FileScanEvent): boolean {
  return event.event === "file.rescan_requested" && event.queued === false;
}

/**
 * The engine on the line. A scan carries the engine it ran under; a request carries the engine
 * recorded for the firm at the moment somebody asked, which is what decided whether it could be
 * queued at all. Either way a row with none says so.
 */
export function scanEventEngineText(event: FileScanEvent): string {
  return event.scanEngineVersion ?? "No engine";
}

/*
 * THE DETAIL COLUMN. Most of what lands there is the engine's own words — a rule id, a signature
 * name, a heuristic reason — and those stand verbatim, in the monospace they were written in,
 * because paraphrasing what a scanner said is how an audit trail stops being one.
 *
 * Three of them are not the engine's. The platform writes them itself
 * (packages/file-manager/src/verdict.ts), and as codes they say nothing to the person reading a
 * file's record, so they are stated in that person's words instead. That is a translation of our
 * own vocabulary, not a gloss on somebody else's.
 */
const PLATFORM_SCAN_DETAILS: Readonly<Record<string, string>> = {
  "active-content": "Holds active content: macros or embedded scripts.",
  encrypted: "Encrypted, so the contents could not be read.",
  "no-engine": "No scan engine was reporting, so nothing was checked.",
};

export interface ScanDetailReading {
  readonly text: string;
  /** True where the words are the engine's own and must be shown exactly as recorded. */
  readonly verbatim: boolean;
}

/**
 * What a line's detail says. A request that never reached the queue explains itself from the two
 * facts the request recorded — whether it was queued, and what engine stood at the time — rather
 * than leaving the reader to work out why nothing happened.
 */
export function scanEventDetailReading(event: FileScanEvent): ScanDetailReading {
  if (scanRequestWasNotQueued(event)) {
    return {
      text:
        event.scanEngineVersion === null
          ? "No scan engine was reporting, so no check could be queued."
          : "The check could not be queued. Nothing ran.",
      verbatim: false,
    };
  }
  if (event.scanDetail === null) return { text: "", verbatim: false };
  const ours = PLATFORM_SCAN_DETAILS[event.scanDetail];
  return ours === undefined
    ? { text: event.scanDetail, verbatim: true }
    : { text: ours, verbatim: false };
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
