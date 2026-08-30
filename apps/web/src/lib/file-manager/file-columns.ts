/*
 * The columns, as data. Every view on this surface renders the SAME table — browse, deleted files,
 * search results, the changelog, the inside of an archive — so the columns are declared once here
 * and a view says which set it wants. A column contributes exactly three things: its label, how its
 * value is read off a row, and which of the one filter mechanism's controls fits that value. There
 * are no per-column filter copies.
 *
 * WHAT THE COLUMNS SAY, settled and not re-decidable per view:
 *   - "Date Modified" and "Date Created", never the bare participles.
 *   - "Created By", never "Uploaded By" — an upload is an act of creation.
 *   - "Version" holds a bare number: 12, never v12, and never spaced so it reads as "1 2".
 *   - File Type is always the EXTENSION — "docx", "zip", "mp4" — never our category paraphrase.
 *   - An unset document type is BLANK. Never a stand-in word.
 *   - The Safety cell speaks only the status register's safety words.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { MatterFile } from "./matter-file-api.ts";
import type { FileManagerRow, MatterFileIndex } from "./file-rows.ts";
import { folderAggregate, folderSizeText, formatBytes } from "./file-rows.ts";
import { displayName } from "./file-names.ts";
import type { SafetyKey } from "./file-manager-vocabulary.ts";

/** Stable column identities. Nothing keys off a label — a label is what a reader sees. */
export const FILE_COLUMN_IDENTIFIERS = {
  name: "name",
  fileType: "fileType",
  documentType: "documentType",
  safety: "safety",
  version: "version",
  size: "size",
  createdBy: "createdBy",
  location: "location",
  created: "created",
  modified: "modified",
} as const;

export type FileColumnIdentifier =
  (typeof FILE_COLUMN_IDENTIFIERS)[keyof typeof FILE_COLUMN_IDENTIFIERS];

/**
 * How a file's Safety cell is graded. The order is the order the facts overrule each other: a
 * rejected or flagged file is an Error whatever else is true of it; a file with no committed
 * version has nothing to grade yet; a file nothing has scanned states that plain fact rather than
 * being graded a Warning; a clean file with no document type is the Info band; and a clean, typed
 * file carries the bare mark and no word at all.
 */
export function safetyKeyOf(file: MatterFile): SafetyKey {
  if (file.status === "quarantined" || file.scanVerdict === "flagged") return "error";
  if (file.status === "pending" || file.currentVersionId === null) return "warning";
  if (file.scanVerdict === null || file.scanVerdict === "unscanned") return "not-scanned";
  if (file.documentTypeId === null) return "info";
  return "clean";
}

/**
 * The file's type is its real extension. A file whose name carries none falls back to the extension
 * its sniffed media type implies, and failing that reads blank — never a placeholder word.
 */
export function fileExtension(file: Pick<MatterFile, "name" | "sniffedContentType">): string {
  const dot = file.name.lastIndexOf(".");
  if (dot > 0 && dot < file.name.length - 1) return file.name.slice(dot + 1).toLowerCase();
  if (file.sniffedContentType === null) return "";
  return EXTENSION_BY_CONTENT_TYPE[file.sniffedContentType] ?? "";
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "message/rfc822": "eml",
};

/** Everything a column needs from the surface to read a row. */
export interface FileColumnContext {
  readonly index: MatterFileIndex;
  /** Whether names render without their extension. */
  readonly hideExtensions: boolean;
  /** The firm's label for a document type, or the empty string when none is set. */
  readonly documentTypeName: (documentTypeId: string | null) => string;
  /**
   * Who created the row's file. The listing carries no author, so where the surface cannot answer
   * this honestly it returns the empty string and the cell renders blank rather than "You".
   */
  readonly createdBy: (file: MatterFile) => string;
}

const emptyIfNull = (value: string | null): string => value ?? "";

/**
 * The browse columns. Folder rows answer every one of them — a folder's Size reads bytes and count,
 * its Date Modified is the most recent modification beneath it, its Safety is the worst word true
 * of its contents — because a folder row is a row of this table and not a special case.
 */
export function browseColumns(context: FileColumnContext): GridColumn<FileManagerRow>[] {
  const { index, hideExtensions, documentTypeName, createdBy } = context;
  const aggregate = (folderId: string) => folderAggregate(index, folderId, safetyKeyOf);

  return [
    {
      id: FILE_COLUMN_IDENTIFIERS.name,
      label: "Name",
      type: "text",
      filter: "text",
      anchored: true,
      // A folder icon and the row's own glyph ride ahead of the text; the fit measurement has to
      // account for them or a double-click fit clips every name by the width of its icon.
      fitExtra: 28,
      value: (row) =>
        row.kind === "folder" ? row.folder.name : displayName(row.file.name, hideExtensions),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.fileType,
      label: "File Type",
      type: "text",
      filter: "set",
      value: (row) => (row.kind === "folder" ? "" : fileExtension(row.file)),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.documentType,
      label: "Document Type",
      type: "text",
      filter: "set",
      value: (row) => (row.kind === "folder" ? "" : documentTypeName(row.file.documentTypeId)),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.safety,
      label: "Safety",
      type: "text",
      filter: "set",
      value: (row) =>
        statusEntry(row.kind === "folder" ? aggregate(row.folder.id).safety : safetyKeyOf(row.file))
          .label,
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.version,
      label: "Version",
      type: "number",
      filter: "range",
      filterNote: "The version number, as the Version column shows it.",
      value: (row) => (row.kind === "folder" ? null : row.file.versionNumber),
      // A bare number, never "v12" — and the cell renders it without tabular figures so a
      // two-digit version does not read as two separate numerals.
      text: (row) => (row.kind === "folder" ? "" : String(row.file.versionNumber)),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.size,
      label: "Size",
      type: "number",
      filter: "range",
      filterNote: "In bytes, as stored.",
      value: (row) =>
        row.kind === "folder" ? aggregate(row.folder.id).totalBytes : row.file.sizeBytes,
      text: (row) =>
        row.kind === "folder"
          ? folderSizeText(aggregate(row.folder.id))
          : formatBytes(row.file.sizeBytes),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.createdBy,
      label: "Created By",
      type: "text",
      filter: "set",
      value: (row) => (row.kind === "folder" ? "" : createdBy(row.file)),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.location,
      label: "Location",
      type: "text",
      filter: "set",
      // Derivable from the folder, so it says nothing inside a folder listing and everything in
      // the results and analysis views. Off here, forced on there.
      hidden: true,
      value: (row) =>
        index.pathText(row.kind === "folder" ? row.folder.parentFolderId : row.file.folderId),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.created,
      label: "Date Created",
      type: "date",
      filter: "dateRange",
      hidden: true,
      value: (row) => (row.kind === "folder" ? null : row.file.createdAt),
    },
    {
      id: FILE_COLUMN_IDENTIFIERS.modified,
      label: "Date Modified",
      type: "date",
      filter: "dateRange",
      value: (row) =>
        row.kind === "folder"
          ? emptyIfNull(aggregate(row.folder.id).latestModified)
          : row.file.updatedAt,
    },
  ];
}

/**
 * The search-results and analysis columns: the browse set with Location forced on, because a row
 * whose neighbours live in different folders is unreadable without saying where each one is.
 */
export function locatedColumns(context: FileColumnContext): GridColumn<FileManagerRow>[] {
  return browseColumns(context).map((column) =>
    column.id === FILE_COLUMN_IDENTIFIERS.location ? { ...column, hidden: false } : column,
  );
}
