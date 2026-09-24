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
import { formatInstant } from "@magna-carta/design-system/formatters";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { DeletedFileSummary, FileHistoryEntry, MatterFile } from "./matter-file-api.ts";
import type { ArchiveRow } from "./archive-browse.ts";
import type { FileManagerRow, MatterFileIndex } from "./file-rows.ts";
import { folderAggregate, folderSizeText, formatBytes } from "./file-rows.ts";
import { displayName } from "./file-names.ts";
import { countPhrase, type SafetyKey } from "./file-manager-vocabulary.ts";

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
 * being graded a Warning; and a clean file carries the bare mark and no word at all. Whether a
 * file has a document type is not a safety fact: a firm that does not use types would otherwise
 * read an Info mark on every file it holds.
 */
export function safetyKeyOf(
  file: Pick<MatterFile, "status" | "scanVerdict" | "currentVersionId">,
): SafetyKey {
  if (file.status === "quarantined" || file.scanVerdict === "flagged") return "error";
  if (file.status === "pending" || file.currentVersionId === null) return "warning";
  if (file.scanVerdict === null || file.scanVerdict === "unscanned") return "not-scanned";
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
      filter: "set",
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
      id: FILE_COLUMN_IDENTIFIERS.created,
      label: "Date Created",
      type: "date",
      filter: "dateRange",
      hidden: true,
      value: (row) => (row.kind === "folder" ? null : row.file.createdAt),
      // The instant, not the type's date-only rendering: file work happens within a day.
      text: (row) => (row.kind === "folder" ? "" : formatInstant(row.file.createdAt)),
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
      text: (row) => {
        const instant =
          row.kind === "folder" ? aggregate(row.folder.id).latestModified : row.file.updatedAt;
        return instant === null ? "" : formatInstant(instant);
      },
    },
  ];
}

/**
 * The search-results and analysis columns: the browse set plus Location, because a row whose
 * neighbours live in different folders is unreadable without saying where each one is.
 *
 * LOCATION EXISTS ONLY HERE (owner ruling, 2026-09-16). A folder listing already answers "where is
 * this" in the crumb above it and the tree beside it, so in browse the column restated the one fact
 * the reader could not get away from, once per row, and it had to ship hidden to keep from doing
 * so. A column whose only honest setting is off in the view a reader spends their time in is not a
 * column that view has; keeping it there as an option meant the browse table could be switched into
 * a state where a whole column read the same value top to bottom. These two views are where rows
 * genuinely come from different folders, so this is where the question is real.
 */
export function locatedColumns(context: FileColumnContext): GridColumn<FileManagerRow>[] {
  const columns = browseColumns(context);
  const location: GridColumn<FileManagerRow> = {
    id: FILE_COLUMN_IDENTIFIERS.location,
    label: "Location",
    type: "text",
    filter: "set",
    value: (row) =>
      context.index.pathText(row.kind === "folder" ? row.folder.parentFolderId : row.file.folderId),
  };
  // Seated where it was: after who made the file, ahead of the dates.
  const before = columns.findIndex((column) => column.id === FILE_COLUMN_IDENTIFIERS.created);
  const at = before === -1 ? columns.length : before;
  return [...columns.slice(0, at), location, ...columns.slice(at)];
}

/**
 * The Deleted Files view's columns: the file's identity plus the two facts that only make sense
 * here — when it went and who sent it — because sorting by deletion time is the whole reason a
 * person opens this list. "Was In" resolves against the folders that exist NOW; a path whose
 * folder went with the file says so rather than reading blank.
 */
export function deletedColumns(
  context: Pick<FileColumnContext, "index" | "hideExtensions" | "documentTypeName">,
): GridColumn<DeletedFileSummary>[] {
  const { index, hideExtensions, documentTypeName } = context;
  const wasIn = (row: DeletedFileSummary): string => {
    if (row.folderId === null) return "Home";
    return index.folderById(row.folderId) === undefined
      ? "A folder deleted with it"
      : index.pathText(row.folderId);
  };
  return [
    {
      id: "name",
      label: "Name",
      type: "text",
      filter: "set",
      anchored: true,
      fitExtra: 28,
      value: (row) => displayName(row.name, hideExtensions),
    },
    {
      id: "fileType",
      label: "File Type",
      type: "text",
      filter: "set",
      value: (row) => fileExtension(row),
    },
    {
      id: "documentType",
      label: "Document Type",
      type: "text",
      filter: "set",
      value: (row) => documentTypeName(row.documentTypeId),
    },
    {
      id: "size",
      label: "Size",
      type: "number",
      filter: "range",
      filterNote: "In bytes, as stored.",
      value: (row) => row.sizeBytes,
      text: (row) => formatBytes(row.sizeBytes),
    },
    {
      id: "deleted",
      label: "Deleted",
      type: "date",
      filter: "dateRange",
      value: (row) => row.deletedAt,
      // When it happened matters to the minute here; the type's date-only text is not enough.
      text: (row) => formatInstant(row.deletedAt),
    },
    {
      id: "deletedBy",
      label: "Deleted By",
      type: "text",
      filter: "set",
      value: (row) => row.deletedByName ?? "",
    },
    {
      id: "wasIn",
      label: "Was In",
      type: "text",
      filter: "set",
      value: wasIn,
    },
    {
      // The way back rides the row itself: a list of recoverable files where recovery is a trip
      // to a menu is a list of chores. The surface renders the control in this cell.
      id: "restore",
      label: "",
      type: "text",
      value: () => "",
    },
  ];
}

/**
 * Inside an archive is still the matter's file list, so the columns keep the browse table's shape.
 * A column an archive member has no answer for is EMPTY, never guessed: a member carries no version
 * history, no document type, and no scan verdict of its own — the archive holds those, and saying
 * otherwise would be a false statement about a file's safety.
 */
export function archiveColumns(): GridColumn<ArchiveRow>[] {
  return [
    {
      id: "name",
      label: "Name",
      type: "text",
      filter: "set",
      anchored: true,
      fitExtra: 28,
      value: (row) => row.name,
    },
    {
      id: "fileType",
      label: "File Type",
      type: "text",
      filter: "set",
      value: (row) => {
        if (row.kind === "directory") return "";
        const dot = row.name.lastIndexOf(".");
        return dot > 0 && dot < row.name.length - 1 ? row.name.slice(dot + 1).toLowerCase() : "";
      },
    },
    {
      id: "size",
      label: "Size",
      type: "number",
      filter: "range",
      filterNote: "Uncompressed bytes, as the archive's directory records them.",
      value: (row) => (row.kind === "directory" ? row.totalBytes : row.sizeBytes),
      text: (row) =>
        row.kind === "directory"
          ? `${formatBytes(row.totalBytes)} · ${countPhrase(row.fileCount, "file")}`
          : formatBytes(row.sizeBytes),
    },
    {
      id: "modified",
      label: "Date Modified",
      type: "date",
      filter: "dateRange",
      value: (row) => (row.kind === "directory" ? null : row.modifiedAt),
      text: (row) =>
        row.kind === "directory" || row.modifiedAt === null ? "" : formatInstant(row.modifiedAt),
    },
  ];
}

/**
 * What each audit event reads as in the History view's Action column. The raw event name is the
 * record; this is only its reading voice, and an event this map does not know renders its own
 * suffix in words rather than being dropped.
 */
const HISTORY_ACTION_LABELS: Readonly<Record<string, string>> = {
  "file.upload_initiated": "Upload Started",
  "file.upload_completed": "Uploaded",
  "file.upload_aborted": "Upload Abandoned",
  "file.version_committed": "New Version",
  "file.version_rescanned": "Re-scanned",
  "file.version_restored": "Version Restored",
  "file.version_skipped": "Version Skipped",
  "file.renamed": "Renamed",
  "file.moved": "Moved",
  "file.deleted": "Deleted",
  "file.restored": "Restored",
  "file.document_type_assigned": "Document Type Set",
  "file.quarantined": "Flagged",
  "document.checkin_initiated": "Check-in Started",
  // Making a folder is an act on the matter's files like any other, and the trail carries it.
  "folder.created": "Folder Created",
  "folder.renamed": "Folder Renamed",
  "folder.moved": "Folder Moved",
  "folder.deleted": "Folder Deleted",
};

export function historyActionLabel(event: string): string {
  const known = HISTORY_ACTION_LABELS[event];
  if (known !== undefined) return known;
  const tail = event.split(".").at(-1) ?? event;
  return tail
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The History view's columns: the matter changelog on the matter's own table. */
export function historyColumns(): GridColumn<FileHistoryEntry>[] {
  return [
    {
      id: "time",
      label: "Time",
      type: "date",
      filter: "dateRange",
      anchored: true,
      value: (row) => row.at,
      // A changelog's whole point is when, so the entry carries its time of day.
      text: (row) => formatInstant(row.at),
    },
    {
      id: "action",
      label: "Action",
      type: "text",
      filter: "set",
      value: (row) => historyActionLabel(row.event),
    },
    /*
     * The subject: the file or the folder the act was done to. One column rather than two, because
     * a reader scanning the trail is asking "what was this done to", and splitting that into a File
     * column and a Folder column would leave every row half empty.
     */
    {
      id: "subject",
      label: "File or Folder",
      type: "text",
      filter: "set",
      value: (row) => row.subjectName,
    },
    {
      id: "subjectKind",
      label: "Kind",
      type: "text",
      filter: "set",
      hidden: true,
      value: (row) => (row.subjectKind === "folder" ? "Folder" : "File"),
    },
    {
      id: "from",
      label: "From",
      type: "text",
      filter: "set",
      value: (row) => row.fromText ?? "",
    },
    {
      id: "to",
      label: "To",
      type: "text",
      filter: "set",
      value: (row) => row.toText ?? "",
    },
    {
      id: "version",
      label: "Version",
      type: "number",
      filter: "range",
      hidden: true,
      value: (row) => row.versionNumber,
      text: (row) => (row.versionNumber === null ? "" : String(row.versionNumber)),
    },
    {
      id: "source",
      label: "Source",
      type: "text",
      filter: "set",
      value: (row) => row.actorName ?? "",
    },
  ];
}
