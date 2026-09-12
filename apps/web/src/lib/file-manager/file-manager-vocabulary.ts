/*
 * What this surface is allowed to say about a file's standing — expressed as keys into the one
 * status register, never as words of its own.
 *
 * The register (`@magna-carta/design-system/status-register`) already carries the safety
 * vocabulary: error, warning, info, not-scanned, clean, each with its label, its tone and what it
 * means on hover. This module adds only what is genuinely the file manager's own and is not a
 * status word: which register key an ISSUE KIND falls under, the order an aggregate picks its worst
 * key in, and the count phrases. Everything a reader actually sees comes back out of the register,
 * so a correction to a word or a tone lands once and every surface follows.
 */
import {
  STATUS_VOCABULARIES,
  statusEntry,
  type StatusKey,
} from "@magna-carta/design-system/status-register";

/** The register keys the Safety column may carry. Nothing outside this set belongs in that cell. */
export type SafetyKey = (typeof STATUS_VOCABULARIES.safety)[number];

/** The safety vocabulary in reading order — what a set filter and a legend both take. */
export const SAFETY_KEYS: readonly SafetyKey[] = STATUS_VOCABULARIES.safety;

/**
 * The three severity bands the analysis view counts and filters by. They are register keys, so the
 * band's word and tone are the same word and tone the Safety column speaks.
 */
export const SEVERITY_BAND_KEYS = [
  "error",
  "warning",
  "info",
] as const satisfies readonly StatusKey[];
export type SeverityBandKey = (typeof SEVERITY_BAND_KEYS)[number];

/**
 * Every kind of issue a file can carry, and the band it falls in. An issue is per file per kind,
 * so a judgement to ignore one never silences the others.
 */
export type IssueKind = "signature" | "mismatch" | "unscanned" | "noVersion";

export interface IssueKindEntry {
  readonly kind: IssueKind;
  /** What the finding IS. Not a status word: the status word is `band`. */
  readonly label: string;
  /** The register key this kind is graded as. */
  readonly band: SeverityBandKey;
  /** Lower ranks are worse; the worst kind on a file decides which band the card reads in. */
  readonly rank: number;
}

export const ISSUE_KINDS: Readonly<Record<IssueKind, IssueKindEntry>> = {
  signature: { kind: "signature", label: "Signature Match", band: "error", rank: 0 },
  mismatch: { kind: "mismatch", label: "Type Mismatch", band: "error", rank: 1 },
  unscanned: { kind: "unscanned", label: "Never Scanned", band: "warning", rank: 2 },
  noVersion: { kind: "noVersion", label: "No Committed Version", band: "warning", rank: 3 },
};

export const ISSUE_KIND_LIST: readonly IssueKindEntry[] = Object.values(ISSUE_KINDS).toSorted(
  (left, right) => left.rank - right.rank,
);

/**
 * The order a folder's aggregate picks its worst key in. Warning and Not scanned share the warning
 * band; the order inside it follows how bad the file's own state is, not the band.
 */
export const AGGREGATE_WORST_ORDER: readonly SafetyKey[] = [
  "error",
  "warning",
  "not-scanned",
  "info",
];

/** The worst key true of anything in the set, or `clean` when nothing needs saying. */
export function worstSafetyKey(keys: readonly SafetyKey[]): SafetyKey {
  return AGGREGATE_WORST_ORDER.find((key) => keys.includes(key)) ?? "clean";
}

/** The word itself, for the one place a comparison or a filter needs the rendered text. */
export function safetyLabel(key: SafetyKey): string {
  return statusEntry(key).label;
}

/** "3 files" / "1 file" — one phrase builder so two surfaces cannot pluralize differently. */
export function countPhrase(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What a mixed selection IS, in one phrase: "3 files", "2 folders", "5 items". */
export function selectionPhrase(fileCount: number, folderCount: number): string {
  if (fileCount > 0 && folderCount > 0) return countPhrase(fileCount + folderCount, "item");
  if (folderCount > 0) return countPhrase(folderCount, "folder");
  return countPhrase(fileCount, "file");
}
