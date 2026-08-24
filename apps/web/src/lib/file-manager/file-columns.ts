import type { DocumentSummary } from "$lib/documents/document-api.ts";

/*
 * The file list's columns, and the sort behind them.
 *
 * The column set is data, not markup, for two reasons: a person chooses which columns they want, and
 * every column needs the same three things stated once — its label, whether it is right-aligned, and
 * how it sorts. Spreading that across a template is how a column ends up sortable in the header and
 * not in the comparator.
 */

export type FileColumnKey =
  | "name"
  | "fileType"
  | "safety"
  | "version"
  | "size"
  | "created"
  | "modified";

export interface FileColumn {
  readonly key: FileColumnKey;
  readonly label: string;
  /** Name is the row's identity, so it is always present and cannot be switched off. */
  readonly always?: boolean;
  /** Whether the column is shown by default. */
  readonly on: boolean;
  /** Numeric and date columns read better right-aligned against each other. */
  readonly right?: boolean;
}

export const FILE_COLUMNS: readonly FileColumn[] = [
  { key: "name", label: "Name", always: true, on: true },
  { key: "fileType", label: "File Type", on: true },
  { key: "safety", label: "Safety", on: true },
  { key: "version", label: "Version", on: true, right: true },
  { key: "size", label: "Size", on: true, right: true },
  { key: "created", label: "Created", on: false },
  { key: "modified", label: "Date Modified", on: true },
];

export type SortDirection = 1 | -1;

/**
 * The comparator for one column. Every branch falls back to the name, so a column where two rows
 * are equal still has a stable order rather than whatever order the server happened to send.
 */
export function compareDocuments(
  a: DocumentSummary,
  b: DocumentSummary,
  key: FileColumnKey,
  direction: SortDirection,
): number {
  let comparison = 0;
  switch (key) {
    case "name": {
      comparison = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      break;
    }
    case "fileType": {
      comparison = (a.sniffedContentType ?? "~").localeCompare(b.sniffedContentType ?? "~");
      break;
    }
    case "safety": {
      comparison = SAFETY_ORDER[a.status] - SAFETY_ORDER[b.status];
      break;
    }
    case "version": {
      comparison = a.versionNumber - b.versionNumber;
      break;
    }
    case "size": {
      // A size that is not known yet sorts below every known size rather than as zero, which would
      // put a still-processing file among the empty ones.
      comparison = (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1);
      break;
    }
    case "created": {
      comparison = a.createdAt.localeCompare(b.createdAt);
      break;
    }
    case "modified": {
      comparison = a.updatedAt.localeCompare(b.updatedAt);
      break;
    }
  }
  const tieBreak = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return (comparison === 0 ? tieBreak : comparison) * direction;
}

/** Worst first, so sorting by Safety puts what needs attention at the top. */
const SAFETY_ORDER: Record<DocumentSummary["status"], number> = {
  quarantined: 0,
  pending: 1,
  clean: 2,
};

export function sortDocuments(
  documents: readonly DocumentSummary[],
  key: FileColumnKey,
  direction: SortDirection,
): DocumentSummary[] {
  return documents.toSorted((a, b) => compareDocuments(a, b, key, direction));
}

/** The file's kind in the reader's words. The media type is exact but nobody scans a table for it. */
export function friendlyFileType(document: DocumentSummary): string {
  const type = document.sniffedContentType;
  if (type === null) return "Not known yet";
  const known = FRIENDLY_TYPES[type];
  if (known !== undefined) return known;
  const extension = document.name.includes(".")
    ? document.name.slice(document.name.lastIndexOf(".") + 1).toUpperCase()
    : null;
  return extension ?? type;
}

const FRIENDLY_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/msword": "Word 97-2003",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Spreadsheet",
  "application/vnd.ms-excel": "Spreadsheet 97-2003",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "Presentation",
  "application/zip": "Archive",
  "text/plain": "Text",
  "image/jpeg": "Image",
  "image/png": "Image",
  "video/mp4": "Video",
  "message/rfc822": "Email",
};
