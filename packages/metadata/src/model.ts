import type { SupportedFormat } from "./detect.ts";

export type RiskLevel = "high" | "medium" | "low";

// Risk-ordered families of things a file can carry. Document families first, then image families.
export type FindingCategory =
  | "identifying-metadata" // author, lastModifiedBy, company, dates, revision, app/template
  | "tracked-changes" // insertions, deletions, moves, format-change records
  | "comments" // reviewer comments and the names attached to them
  | "hidden-content" // text marked hidden (vanish)
  | "custom-properties" // arbitrary custom document properties
  | "edit-history" // revision save identifiers: which passages were written in which sitting
  | "document-settings" // stored variables, mail-merge data source, attached template path
  | "embedded-preview" // a rendered preview image of the document's first page
  | "embedded-data" // custom XML data parts carried inside the document
  | "image-location" // GPS / camera EXIF
  | "image-software" // editing-software / XMP markers
  | "image-other" // remaining EXIF/IPTC/comment segments
  | "image-trailing-data"; // bytes appended after the end of the image stream

// How a field's value is written. A moment the file stamped with a zone is an instant, shown in the
// reader's own zone. One stamped without a zone (a camera clock) is a date and time of day with no
// zone, shown exactly as written, because converting it would invent a zone the file never named.
export type FieldValue =
  | { readonly form: "text"; readonly text: string }
  | { readonly form: "instant"; readonly instant: string } // exactly Date.prototype.toISOString's shape
  | { readonly form: "zoneless"; readonly date: string; readonly time?: string } // YYYY-MM-DD, HH:MM
  | { readonly form: "minutes"; readonly minutes: number };

export type FieldMoment = Extract<FieldValue, { readonly form: "instant" | "zoneless" }>;

// Where in a word-processing document a passage sits.
export type DocumentPart = "body" | "header" | "footer" | "footnotes" | "endnotes";

// What a tracked change did.
export type RevisionKind = "inserted" | "deleted" | "moved" | "formatted";

// One value a finding carries, read from the file. Every string here came out of untrusted bytes:
// it is cleaned of control and direction-override characters and capped in length
// (MAX_FIELD_TEXT_LENGTH in fields.ts). These are the values themselves, so they are for the person
// who holds the file and never for a log or a response the caller did not ask for.
export interface FindingField {
  readonly name: string; // the property's name, or who made the change or comment ("" when unnamed)
  readonly value: FieldValue;
  readonly when?: FieldMoment; // when a change or comment was made, where the file says
  readonly part?: DocumentPart; // where hidden text sits
  readonly revision?: RevisionKind; // what a tracked change did
}

export interface Finding {
  readonly category: FindingCategory;
  readonly label: string; // human-readable; NEVER the metadata value itself (redaction)
  readonly risk: RiskLevel;
  readonly count: number; // how many instances were found
  readonly defaultScrub: boolean; // included in the one-click "make safe to send" default
  // The values behind the finding, where they can be read. Absent where a finding has no readable
  // value (a preview picture, editing-session identifiers, bytes after the image). Capped at
  // MAX_FIELDS_PER_FINDING; unlistedFieldCount says how many more were read and left out.
  readonly fields?: readonly FindingField[];
  readonly unlistedFieldCount?: number;
}

export interface MetadataReport {
  readonly format: SupportedFormat;
  readonly findings: readonly Finding[];
  readonly clean: boolean;
}

// A finding as a caller that must not carry the file's values publishes it: what was found and how
// much. The server's metadata route answers in this shape, so a value read from a file never rides
// a response that does not declare it.
export function withoutFieldValues(finding: Finding): Finding {
  return {
    category: finding.category,
    label: finding.label,
    risk: finding.risk,
    count: finding.count,
    defaultScrub: finding.defaultScrub,
  };
}

export function reportOf(format: SupportedFormat, findings: readonly Finding[]): MetadataReport {
  return { format, findings, clean: findings.length === 0 };
}
