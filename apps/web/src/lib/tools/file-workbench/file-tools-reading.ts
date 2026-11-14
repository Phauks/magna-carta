/*
 * What the Repair and Text Recognition tabs say about an engine's answer. The engines report in
 * stable codes and raw confidences; the words and the tones live here, once.
 */
import type { BadgeVariant } from "@magna-carta/design-system/badge";
import type { RecognizedPage, RepairDiagnosis } from "./file-tools-api.ts";

const RECOVERABILITY: Readonly<Record<string, { label: string; tone: BadgeVariant }>> = {
  intact: { label: "Not Damaged", tone: "success" },
  repairable: { label: "Repairable", tone: "warning" },
  partial: { label: "Partly Repairable", tone: "warning" },
  unrecoverable: { label: "Not Repairable", tone: "danger" },
  unknown: { label: "Not Recognized", tone: "neutral" },
};

export function recoverabilityOf(diagnosis: RepairDiagnosis): {
  label: string;
  tone: BadgeVariant;
} {
  return RECOVERABILITY[diagnosis.recoverability] ?? { label: "Not Recognized", tone: "neutral" };
}

const CORRUPTION: Readonly<Record<string, string>> = {
  truncated: "The file stops before its end",
  brokenCentralDirectory: "The package's list of parts is damaged",
  missingEndOfCentralDirectory: "The package's list of parts is missing",
  badLocalHeaders: "Some parts have damaged headers",
  missingRequiredParts: "Parts the format needs are missing",
  brokenCrossReference: "The PDF's index of objects is damaged",
  other: "Other damage",
};

export function corruptionName(code: string): string {
  return CORRUPTION[code] ?? CORRUPTION["other"]!;
}

/** Below this average, a page's reading is flagged for a person to check against the page. */
export const LOW_CONFIDENCE = 0.8;

export type PageReading =
  | "already-text"
  | "recognized"
  | "low-confidence"
  | "unreadable"
  | "no-text";

export function pageReading(page: RecognizedPage): PageReading {
  if (page.skipped !== undefined && page.skipped !== null) return "already-text";
  if (page.lines.length === 0) return page.undecodedRegions > 0 ? "unreadable" : "no-text";
  const average = page.lines.reduce((sum, line) => sum + line.confidence, 0) / page.lines.length;
  return average < LOW_CONFIDENCE ? "low-confidence" : "recognized";
}

export const PAGE_READING_LABEL: Readonly<
  Record<PageReading, { label: string; tone: BadgeVariant }>
> = {
  "already-text": { label: "Already Had Text", tone: "neutral" },
  recognized: { label: "Recognized", tone: "success" },
  "low-confidence": { label: "Low Confidence", tone: "warning" },
  unreadable: { label: "Could Not Be Read", tone: "danger" },
  "no-text": { label: "No Text", tone: "neutral" },
};

export function pageText(page: RecognizedPage): string {
  return page.lines.map((line) => line.text).join("\n");
}

export function documentText(pages: readonly RecognizedPage[]): string {
  return pages
    .filter((page) => page.lines.length > 0)
    .map((page) => `Page ${page.pageIndex + 1}\n\n${pageText(page)}`)
    .join("\n\n");
}

/** "Lease.pdf" becomes "Lease (repaired).pdf". */
export function markedName(name: string, mark: string, extension?: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ending = extension ?? (dot <= 0 ? "" : name.slice(dot + 1));
  return ending === "" ? `${stem} (${mark})` : `${stem} (${mark}).${ending}`;
}
