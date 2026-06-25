import type { SupportedFormat } from "./detect.ts";

export type RiskLevel = "high" | "medium" | "low";

// Risk-ordered families of things a file can carry. Document families first, then image families.
export type FindingCategory =
  | "identifying-metadata" // author, lastModifiedBy, company, dates, revision, app/template
  | "tracked-changes" // insertions, deletions, moves, format-change records
  | "comments" // reviewer comments and the names attached to them
  | "hidden-content" // text marked hidden (vanish)
  | "custom-properties" // arbitrary custom document properties
  | "image-location" // GPS / camera EXIF
  | "image-software" // editing-software / XMP markers
  | "image-other"; // remaining EXIF/IPTC/comment segments

export interface Finding {
  readonly category: FindingCategory;
  readonly label: string; // human-readable; NEVER the metadata value itself (redaction)
  readonly risk: RiskLevel;
  readonly count: number; // how many instances were found
  readonly defaultScrub: boolean; // included in the one-click "make safe to send" default
}

export interface MetadataReport {
  readonly format: SupportedFormat;
  readonly findings: readonly Finding[];
  readonly clean: boolean;
}

export function reportOf(format: SupportedFormat, findings: readonly Finding[]): MetadataReport {
  return { format, findings, clean: findings.length === 0 };
}
