/*
 * The intake — what has been chosen for an upload, as the rows a table shows and the tree they
 * sit in.
 *
 * A pick or a drop hands the dialog a flat list of files, each carrying the path it arrived under
 * ("Discovery/2024/letter.pdf", or "" for a file on its own). The reader needs to see that list the
 * way they see the matter's own files — folders holding files, each level under its parent — so
 * the same shape can be checked before it is sent and watched while it goes. This module turns the
 * flat list into that tree, flattens the tree back into the rows the product's one table renders,
 * and keeps the two operations pure so they are asserted here rather than watched in a browser.
 *
 * WHY THE ROWS ARE FLAT AND THE ORDER IS THE TABLE'S. The table is the platform's one grid: its
 * filters, its header menu, its selection and its counts strip are the settled behaviour every
 * list has, and a second tree control beside it would be a second list with its own rules. So the
 * grid gets ordinary rows carrying their depth, and is handed `orderIntakeRows` as the way to put
 * them in order — siblings sorted by whatever column the reader chose, each child kept under its
 * parent — which is what lets a sort still mean what it says inside a hierarchy.
 *
 * A FILTER FLATTENS. A filter names files, not places: "everything ending in .pdf" is a question
 * about files, and answering it with half-empty folders and orphaned indents would be answering a
 * different question. So while any filter is in play the rows are the matching files alone, at one
 * depth, with the Folder column saying where each one sits — the same rule the file manager's
 * search results follow when they force Location on.
 */
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { folderPathOf } from "@magna-carta/design-system/dropzone";
import { formatInstant } from "@magna-carta/design-system/formatters";
import { formatBytes } from "./file-rows.ts";
import { countPhrase } from "./file-manager-vocabulary.ts";
import { UPLOAD_STAGE_NARRATION, type UploadStage } from "./file-upload.ts";

/** Where one chosen file stands: not yet sent, one of the ceremony's steps, or failed. */
export type IntakeStage = "chosen" | UploadStage | "failed";

export interface IntakeProgress {
  readonly stage: IntakeStage;
  /** Why it failed, when it did — the stage and the Error ID, in the reader's words. */
  readonly reason?: string;
}

/**
 * The key one chosen file is known by, across the tree, the table and the transfer. The path, the
 * name, the size and the device date together: two files with all four alike are the same file
 * offered twice, whichever way they arrived.
 */
export function intakeEntryKey(entry: DroppedEntry): string {
  return [
    entry.relativePath,
    entry.file.name,
    String(entry.file.size),
    String(entry.file.lastModified),
  ].join(" | ");
}

const FILE_KEY_PREFIX = "file:";
const FOLDER_KEY_PREFIX = "folder:";

export function intakeFileKey(entry: DroppedEntry): string {
  return FILE_KEY_PREFIX + intakeEntryKey(entry);
}

export function intakeFolderKey(path: string): string {
  return FOLDER_KEY_PREFIX + path;
}

/** One file offered twice is one file: a second drop of the same folder must not double it. */
export function addIntakeEntries(
  existing: readonly DroppedEntry[],
  incoming: readonly DroppedEntry[],
): DroppedEntry[] {
  const seen = new Set(existing.map(intakeEntryKey));
  const added: DroppedEntry[] = [];
  for (const entry of incoming) {
    const key = intakeEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(entry);
  }
  return added.length === 0 ? [...existing] : [...existing, ...added];
}

/**
 * The entries left after removing the given rows. Removing a folder removes everything beneath it,
 * because a folder in this list IS its contents — there is nothing else to a folder that has not
 * been made yet.
 */
export function removeIntakeRows(
  existing: readonly DroppedEntry[],
  rowKeys: Iterable<string>,
): DroppedEntry[] {
  const fileKeys = new Set<string>();
  const folderPaths: string[] = [];
  for (const key of rowKeys) {
    if (key.startsWith(FILE_KEY_PREFIX)) fileKeys.add(key.slice(FILE_KEY_PREFIX.length));
    else if (key.startsWith(FOLDER_KEY_PREFIX)) {
      folderPaths.push(key.slice(FOLDER_KEY_PREFIX.length));
    }
  }
  return existing.filter((entry) => {
    if (fileKeys.has(intakeEntryKey(entry))) return false;
    const folder = folderPathOf(entry);
    return !folderPaths.some((path) => folder === path || folder.startsWith(`${path}/`));
  });
}

/** A folder's own name from its path — the last segment. */
function folderName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/** The folder a path sits in: "" for a top-level folder. */
function parentPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export interface IntakeFolderRow {
  readonly kind: "folder";
  readonly key: string;
  /** The folder's path from the intake root: "Discovery/2024". */
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  /** Every file anywhere beneath it. */
  readonly fileCount: number;
  readonly totalBytes: number;
  /** The most recent device date among the files beneath it, as milliseconds; null when none had one. */
  readonly latestModified: number | null;
  /** How the files beneath it are doing, once the transfer runs. */
  readonly uploaded: number;
  readonly failed: number;
  readonly inFlight: number;
  /** Whether the row is showing its children. */
  readonly expanded: boolean;
}

export interface IntakeFileRow {
  readonly kind: "file";
  readonly key: string;
  readonly entry: DroppedEntry;
  /** The folder it sits in, "" at the intake root. */
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly stage: IntakeStage;
  readonly reason?: string;
}

export type IntakeRow = IntakeFolderRow | IntakeFileRow;

interface FolderNode {
  readonly path: string;
  readonly children: Map<string, FolderNode>;
  readonly files: DroppedEntry[];
}

function buildTree(entries: readonly DroppedEntry[]): FolderNode {
  const root: FolderNode = { path: "", children: new Map(), files: [] };
  for (const entry of entries) {
    const folder = folderPathOf(entry);
    let node = root;
    if (folder !== "") {
      let path = "";
      for (const segment of folder.split("/")) {
        path = path === "" ? segment : `${path}/${segment}`;
        let child = node.children.get(segment);
        if (child === undefined) {
          child = { path, children: new Map(), files: [] };
          node.children.set(segment, child);
        }
        node = child;
      }
    }
    node.files.push(entry);
  }
  return root;
}

interface Aggregate {
  fileCount: number;
  totalBytes: number;
  latestModified: number | null;
  uploaded: number;
  failed: number;
  inFlight: number;
}

function aggregate(node: FolderNode, progress: ReadonlyMap<string, IntakeProgress>): Aggregate {
  const total: Aggregate = {
    fileCount: 0,
    totalBytes: 0,
    latestModified: null,
    uploaded: 0,
    failed: 0,
    inFlight: 0,
  };
  for (const entry of node.files) {
    total.fileCount += 1;
    total.totalBytes += entry.file.size;
    if (entry.file.lastModified > 0) {
      total.latestModified = Math.max(total.latestModified ?? 0, entry.file.lastModified);
    }
    const stage = progress.get(intakeEntryKey(entry))?.stage ?? "chosen";
    if (stage === "settled") total.uploaded += 1;
    else if (stage === "failed") total.failed += 1;
    else if (stage !== "chosen") total.inFlight += 1;
  }
  for (const child of node.children.values()) {
    const below = aggregate(child, progress);
    total.fileCount += below.fileCount;
    total.totalBytes += below.totalBytes;
    if (below.latestModified !== null) {
      total.latestModified = Math.max(total.latestModified ?? 0, below.latestModified);
    }
    total.uploaded += below.uploaded;
    total.failed += below.failed;
    total.inFlight += below.inFlight;
  }
  return total;
}

function fileRow(
  entry: DroppedEntry,
  depth: number,
  progress: ReadonlyMap<string, IntakeProgress>,
): IntakeFileRow {
  const state = progress.get(intakeEntryKey(entry));
  return {
    kind: "file",
    key: intakeFileKey(entry),
    entry,
    path: folderPathOf(entry),
    name: entry.file.name,
    depth,
    stage: state?.stage ?? "chosen",
    ...(state?.reason === undefined ? {} : { reason: state.reason }),
  };
}

/**
 * The rows the table shows. With `expanded` given, the tree: every folder as a row, its contents
 * beneath it when it is expanded, files at their depth. With `expanded` null, the flat answer a
 * filter wants: every file at depth zero, no folder rows.
 */
export function intakeRows(
  entries: readonly DroppedEntry[],
  progress: ReadonlyMap<string, IntakeProgress>,
  expanded: ReadonlySet<string> | null,
): IntakeRow[] {
  if (expanded === null) return entries.map((entry) => fileRow(entry, 0, progress));
  const rows: IntakeRow[] = [];
  const walk = (node: FolderNode, depth: number): void => {
    for (const child of node.children.values()) {
      const open = expanded.has(child.path);
      rows.push({
        kind: "folder",
        key: intakeFolderKey(child.path),
        path: child.path,
        name: folderName(child.path),
        depth,
        expanded: open,
        ...aggregate(child, progress),
      });
      if (open) walk(child, depth + 1);
    }
    for (const entry of node.files) rows.push(fileRow(entry, depth, progress));
  };
  walk(buildTree(entries), 0);
  return rows;
}

/** Every folder path the intake holds, so a tree can open fully on arrival. */
export function intakeFolderPaths(entries: readonly DroppedEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    const folder = folderPathOf(entry);
    if (folder === "") continue;
    let path = "";
    for (const segment of folder.split("/")) {
      path = path === "" ? segment : `${path}/${segment}`;
      paths.add(path);
    }
  }
  return [...paths];
}

/**
 * The grid's ordering for these rows: siblings sorted by the grid's own comparator, every child
 * kept under its parent, folders ahead of files at each level (a folder is a place, and places
 * lead the things in them in every file listing the product draws). A row whose parent is not
 * among the rows — filtered out, or collapsed — sits under the nearest ancestor that is, or at the
 * root, so nothing is ever dropped by the arrangement.
 */
export function orderIntakeRows(
  rows: readonly IntakeRow[],
  compare: (left: IntakeRow, right: IntakeRow) => number,
): IntakeRow[] {
  const present = new Set(rows.filter((row) => row.kind === "folder").map((row) => row.path));
  const childrenOf = new Map<string, IntakeRow[]>();
  const parentOf = (row: IntakeRow): string => {
    let path = row.kind === "folder" ? parentPath(row.path) : row.path;
    while (path !== "" && !present.has(path)) path = parentPath(path);
    return path;
  };
  for (const row of rows) {
    const parent = parentOf(row);
    const siblings = childrenOf.get(parent) ?? [];
    siblings.push(row);
    childrenOf.set(parent, siblings);
  }
  const ordered: IntakeRow[] = [];
  const emit = (parent: string): void => {
    const siblings = childrenOf.get(parent) ?? [];
    const folders = siblings.filter((row) => row.kind === "folder").toSorted(compare);
    const files = siblings.filter((row) => row.kind === "file").toSorted(compare);
    for (const folder of folders) {
      ordered.push(folder);
      if (folder.kind === "folder") emit(folder.path);
    }
    ordered.push(...files);
  };
  emit("");
  return ordered;
}

/** The status word a row's stage reads as, in the Status column. */
export const INTAKE_STAGE_LABEL: Readonly<Record<IntakeStage, string>> = {
  chosen: "Chosen",
  reserving: "Reserving",
  uploading: "Sending",
  committing: "Recording",
  scanning: "Checking",
  settled: "Uploaded",
  failed: "Upload failed",
};

/** The Status column's values, in the order the transfer moves through them. */
export const INTAKE_STAGE_ORDER: readonly IntakeStage[] = [
  "chosen",
  "reserving",
  "uploading",
  "committing",
  "scanning",
  "settled",
  "failed",
];

/** The one sentence a row's stage says in full — the tooltip behind the status word. */
export function intakeStageSentence(row: IntakeFileRow): string {
  if (row.stage === "chosen") return "Chosen.";
  if (row.stage === "failed") return row.reason ?? "Upload failed.";
  if (row.stage === "settled") return "Uploaded.";
  return UPLOAD_STAGE_NARRATION[row.stage];
}

/** A folder row's standing, as one phrase: what is chosen, or how its files are doing. */
export function intakeFolderStatus(row: IntakeFolderRow): string {
  if (row.uploaded === 0 && row.failed === 0 && row.inFlight === 0) return "Chosen";
  const parts = [`${String(row.uploaded)} of ${String(row.fileCount)} uploaded`];
  if (row.failed > 0) parts.push(`${String(row.failed)} failed`);
  return parts.join(" · ");
}

/** The file's extension, lower-cased, or "" when it has none. */
export function intakeExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * The columns of the intake table. The same facts the file manager's browse table shows about a
 * file, plus where each stands in the transfer; the Folder column is on only while a filter has
 * flattened the tree, because inside the tree the indent already says it.
 */
export function intakeColumns(context: { readonly filtering: boolean }): GridColumn<IntakeRow>[] {
  return [
    {
      id: "name",
      label: "Name",
      type: "text",
      filter: "text",
      anchored: true,
      // Furniture beyond the text: the indent, the twisty and the glyph.
      fitExtra: 72,
      value: (row) => row.name,
    },
    {
      id: "folder",
      label: "Folder",
      type: "text",
      filter: "set",
      hidden: !context.filtering,
      value: (row) => {
        const path = row.kind === "folder" ? parentPath(row.path) : row.path;
        return path === "" ? "Home" : path.replaceAll("/", " / ");
      },
    },
    {
      id: "fileType",
      label: "File Type",
      type: "text",
      filter: "set",
      value: (row) => (row.kind === "folder" ? "Folder" : intakeExtension(row.name)),
    },
    {
      id: "size",
      label: "Size",
      type: "number",
      filter: "range",
      filterNote: "In bytes, as the device reports them.",
      value: (row) => (row.kind === "folder" ? row.totalBytes : row.entry.file.size),
      text: (row) =>
        row.kind === "folder"
          ? `${formatBytes(row.totalBytes)} · ${countPhrase(row.fileCount, "file")}`
          : formatBytes(row.entry.file.size),
    },
    {
      id: "modified",
      label: "Date Modified",
      type: "date",
      filter: "dateRange",
      // Off until asked for: the pane is narrower than the file list, and the device's date matters
      // less here than whether the file went. The header menu shows it.
      hidden: true,
      value: (row) => {
        const instant = row.kind === "folder" ? row.latestModified : row.entry.file.lastModified;
        return instant === null || instant <= 0 ? null : new Date(instant);
      },
      text: (row) => {
        const instant = row.kind === "folder" ? row.latestModified : row.entry.file.lastModified;
        return instant === null || instant <= 0 ? "" : formatInstant(new Date(instant));
      },
    },
    {
      id: "status",
      label: "Status",
      type: "text",
      filter: "set",
      // Stuck to the trailing edge, so where a file stands is in reach however wide the names run.
      pinnedEnd: true,
      filterValues: INTAKE_STAGE_ORDER.map((stage) => INTAKE_STAGE_LABEL[stage]),
      value: (row) =>
        row.kind === "folder" ? intakeFolderStatus(row) : INTAKE_STAGE_LABEL[row.stage],
    },
  ];
}

/** What has been chosen, in one phrase: "3 files", or "2 folders, 14 files inside". */
export function intakePhrase(entries: readonly DroppedEntry[]): string {
  const folders = new Set(
    entries.map((entry) => entry.relativePath.split("/")[0] ?? "").filter((head) => head !== ""),
  ).size;
  if (folders === 0) return countPhrase(entries.length, "file");
  return `${countPhrase(folders, "folder")}, ${countPhrase(entries.length, "file")} inside`;
}

/** The bytes the intake holds, summed. */
export function intakeBytes(entries: readonly DroppedEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.file.size, 0);
}
