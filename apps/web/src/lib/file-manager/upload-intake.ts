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
import { formatBytes, orderFolderRowsFirst } from "./file-rows.ts";
import { countPhrase } from "./file-manager-vocabulary.ts";
import { UPLOAD_STAGE_NARRATION, type UploadStage } from "./file-upload.ts";

/**
 * Where one chosen file stands. BEFORE its turn comes it is being made ready — chosen and waiting
 * to be read, being read ("hashing"), read and ready to go, read and found to be bytes the firm
 * already holds (so nothing will be sent for it), or unreadable here. Once the transfer reaches it,
 * it moves through the ceremony's steps, and ends uploaded, already on the matter, failed, or not
 * sent because the reader cancelled the batch first.
 */
export type IntakeStage =
  | "chosen"
  | "hashing"
  | "ready"
  | "held"
  | "unread"
  | UploadStage
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * The stages a file sits in before any byte of it has moved: what readiness is made of. A batch
 * takes these files in turn; none of them is in flight, and none has finished.
 */
export const PRE_SEND_STAGES: ReadonlySet<IntakeStage> = new Set<IntakeStage>([
  "chosen",
  "hashing",
  "ready",
  "held",
  "unread",
]);

export function isPreSendStage(stage: IntakeStage): boolean {
  return PRE_SEND_STAGES.has(stage);
}

/**
 * What happens to a chosen file whose name is already taken in the folder it would land in. The
 * reader decides, per file or for the batch: file it beside the other under a numbered name, file
 * it as the next version of the file that has the name, or leave it out. Identical BYTES are never
 * the question here — a file the firm already holds is copied rather than sent, and still becomes
 * its own file; only a NAME clash asks anything.
 */
export type NameClashChoice = "keep-both" | "new-version" | "skip";

export const NAME_CLASH_LABEL: Readonly<Record<NameClashChoice, string>> = {
  "keep-both": "Keep both",
  "new-version": "New version",
  skip: "Skip",
};

export const NAME_CLASH_ORDER: readonly NameClashChoice[] = ["keep-both", "new-version", "skip"];

/** A file's name clash, as the dialog resolves it: who has the name, and what the reader chose. */
export type IntakeNameClash = (key: string) => { takenBy: string; choice: NameClashChoice } | null;

const NO_NAME_CLASH: IntakeNameClash = () => null;

export interface IntakeProgress {
  readonly stage: IntakeStage;
  /** Why it failed, when it did — the whole sentence: the fault, the stage and the Error ID. */
  readonly reason?: string;
  /**
   * What failed, in one short line the row can show without being pointed at: the server's own
   * problem detail where it gave one, the class of transport fault where it did not.
   */
  readonly failure?: string;
  /** Bytes the browser has sent so far, while the file is being sent. */
  readonly sentBytes?: number;
  /** Bytes read so far, while the file is being hashed. */
  readonly hashedBytes?: number;
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

/**
 * The intake keys of every file the given table rows stand for: a file row is itself, a folder row
 * is everything beneath it. What a control acting on the selection — setting a document type,
 * removing what was chosen — actually operates on.
 */
export function intakeKeysOfRows(
  entries: readonly DroppedEntry[],
  rowKeys: Iterable<string>,
): string[] {
  const fileKeys = new Set<string>();
  const folderPaths: string[] = [];
  for (const key of rowKeys) {
    if (key.startsWith(FILE_KEY_PREFIX)) fileKeys.add(key.slice(FILE_KEY_PREFIX.length));
    else if (key.startsWith(FOLDER_KEY_PREFIX)) {
      folderPaths.push(key.slice(FOLDER_KEY_PREFIX.length));
    }
  }
  return entries
    .filter((entry) => {
      if (fileKeys.has(intakeEntryKey(entry))) return true;
      const folder = folderPathOf(entry);
      return folderPaths.some((path) => folder === path || folder.startsWith(`${path}/`));
    })
    .map(intakeEntryKey);
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
  /** Files the reader chose to leave out because their names were taken. */
  readonly skipped: number;
  /** Bytes sent so far across the files beneath it; a settled file counts in full. */
  readonly sentBytes: number;
  /** Files read and ready to go, before the transfer runs; the held ones are counted among them. */
  readonly ready: number;
  /** Files whose bytes the firm already holds, so nothing will be sent for them. */
  readonly held: number;
  /** Files that could not be read here, so the firm was not asked about them. */
  readonly unread: number;
  /** Files still being read. */
  readonly reading: number;
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
  /** What failed, in one line, when the upload did. */
  readonly failure?: string;
  /** Bytes sent so far, while the file is being sent. */
  readonly sentBytes: number;
  /** Bytes read so far, while the file is being hashed. */
  readonly hashedBytes: number;
  /** The firm's classification this file will carry, as the reader named it; "" for none. */
  readonly documentType: string;
  /** The file in the landing folder that already has this name, when one does. */
  readonly nameTakenBy: string | null;
  /** What the reader chose for that clash; null where there is none. */
  readonly nameClash: NameClashChoice | null;
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
  skipped: number;
  sentBytes: number;
  ready: number;
  held: number;
  unread: number;
  reading: number;
}

/** What a file's progress counts as sent: everything once the bytes are with the host, else what the browser reports. */
export function sentBytesOf(size: number, state: IntakeProgress | undefined): number {
  if (state === undefined) return 0;
  if (
    state.stage === "settled" ||
    state.stage === "skipped" ||
    state.stage === "committing" ||
    state.stage === "scanning"
  ) {
    return size;
  }
  return Math.min(size, state.sentBytes ?? 0);
}

function aggregate(node: FolderNode, progress: ReadonlyMap<string, IntakeProgress>): Aggregate {
  const total: Aggregate = {
    fileCount: 0,
    totalBytes: 0,
    latestModified: null,
    uploaded: 0,
    failed: 0,
    inFlight: 0,
    skipped: 0,
    sentBytes: 0,
    ready: 0,
    held: 0,
    unread: 0,
    reading: 0,
  };
  for (const entry of node.files) {
    total.fileCount += 1;
    total.totalBytes += entry.file.size;
    if (entry.file.lastModified > 0) {
      total.latestModified = Math.max(total.latestModified ?? 0, entry.file.lastModified);
    }
    const state = progress.get(intakeEntryKey(entry));
    const stage = state?.stage ?? "chosen";
    if (stage === "settled") total.uploaded += 1;
    else if (stage === "skipped") total.skipped += 1;
    else if (stage === "failed") total.failed += 1;
    else if (stage === "hashing") total.reading += 1;
    else if (stage === "ready") total.ready += 1;
    else if (stage === "held") {
      // Held is a kind of ready: the answer is in, and it is that nothing needs sending.
      total.ready += 1;
      total.held += 1;
    } else if (stage === "unread") total.unread += 1;
    else if (stage !== "chosen" && stage !== "cancelled") total.inFlight += 1;
    total.sentBytes += sentBytesOf(entry.file.size, state);
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
    total.skipped += below.skipped;
    total.sentBytes += below.sentBytes;
    total.ready += below.ready;
    total.held += below.held;
    total.unread += below.unread;
    total.reading += below.reading;
  }
  return total;
}

/** What a file's document type is called, by intake key. Absent, no file carries one. */
export type IntakeDocumentTypeName = (key: string) => string;

const NO_DOCUMENT_TYPE: IntakeDocumentTypeName = () => "";

function fileRow(
  entry: DroppedEntry,
  depth: number,
  progress: ReadonlyMap<string, IntakeProgress>,
  documentTypeName: IntakeDocumentTypeName,
  nameClash: IntakeNameClash,
): IntakeFileRow {
  const key = intakeEntryKey(entry);
  const state = progress.get(key);
  const clash = nameClash(key);
  return {
    kind: "file",
    key: intakeFileKey(entry),
    entry,
    path: folderPathOf(entry),
    name: entry.file.name,
    depth,
    stage: state?.stage ?? "chosen",
    ...(state?.reason === undefined ? {} : { reason: state.reason }),
    ...(state?.failure === undefined ? {} : { failure: state.failure }),
    sentBytes: sentBytesOf(entry.file.size, state),
    hashedBytes: Math.min(entry.file.size, state?.hashedBytes ?? 0),
    documentType: documentTypeName(key),
    nameTakenBy: clash === null ? null : clash.takenBy,
    nameClash: clash === null ? null : clash.choice,
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
  documentTypeName: IntakeDocumentTypeName = NO_DOCUMENT_TYPE,
  nameClash: IntakeNameClash = NO_NAME_CLASH,
): IntakeRow[] {
  if (expanded === null) {
    return entries.map((entry) => fileRow(entry, 0, progress, documentTypeName, nameClash));
  }
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
    for (const entry of node.files) {
      rows.push(fileRow(entry, depth, progress, documentTypeName, nameClash));
    }
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
 * kept under its parent, and folders ahead of files at each level through the one rule the flat
 * list uses (`orderFolderRowsFirst`), so a nested listing and a flat one cannot disagree about
 * where a folder sits. A row whose parent is not among the rows — filtered out, or collapsed —
 * sits under the nearest ancestor that is, or at the root, so nothing is ever dropped by the
 * arrangement.
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
    for (const row of orderFolderRowsFirst(childrenOf.get(parent) ?? [], compare)) {
      ordered.push(row);
      if (row.kind === "folder") emit(row.path);
    }
  };
  emit("");
  return ordered;
}

/** The status word a row's stage reads as, in the Status column. */
export const INTAKE_STAGE_LABEL: Readonly<Record<IntakeStage, string>> = {
  chosen: "Chosen",
  hashing: "Reading",
  ready: "Ready",
  held: "Held",
  unread: "Not read",
  matching: "Checking",
  reserving: "Reserving",
  uploading: "Sending",
  committing: "Recording",
  scanning: "Checking",
  settled: "Uploaded",
  skipped: "Skipped",
  failed: "Upload failed",
  cancelled: "Not sent",
};

/** The Status column's values, in the order the transfer moves through them. */
export const INTAKE_STAGE_ORDER: readonly IntakeStage[] = [
  "chosen",
  "hashing",
  "ready",
  "held",
  "unread",
  "matching",
  "reserving",
  "uploading",
  "committing",
  "scanning",
  "settled",
  "skipped",
  "failed",
  "cancelled",
];

/** The share of a file that has gone, as a whole percent, for the row that is sending it. */
export function intakePercent(sentBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 100;
  return Math.min(100, Math.floor((sentBytes / totalBytes) * 100));
}

/**
 * The Status column's text for a file row: the stage word, with the share sent while it is sending
 * and the share read while it is being hashed — a long file is read for seconds before a byte
 * moves, and a row that only said "Reading" for that long would look stuck.
 */
export function intakeFileStatus(row: IntakeFileRow): string {
  if (row.stage === "uploading") {
    const percent = intakePercent(row.sentBytes, row.entry.file.size);
    return `${INTAKE_STAGE_LABEL.uploading} · ${String(percent)}%`;
  }
  if (row.stage === "hashing") {
    const percent = intakePercent(row.hashedBytes, row.entry.file.size);
    return `${INTAKE_STAGE_LABEL.hashing} · ${String(percent)}%`;
  }
  return INTAKE_STAGE_LABEL[row.stage];
}

/** The one sentence a row's stage says in full — the tooltip behind the status word. */
export function intakeStageSentence(row: IntakeFileRow): string {
  if (row.stage === "chosen") return "Chosen, and waiting to be read.";
  if (row.stage === "failed") return row.reason ?? "Upload failed.";
  if (row.stage === "settled") return row.reason ?? "Uploaded.";
  if (row.stage === "hashing") {
    const read = formatBytes(row.hashedBytes);
    return `Reading the file to ask whether the firm already holds it: ${read} of ${formatBytes(row.entry.file.size)}.`;
  }
  if (row.stage === "ready") return "Read, and ready to be sent.";
  if (row.stage === "held") {
    return "The firm already holds a file with exactly these bytes, so nothing will be sent for it.";
  }
  if (row.stage === "unread") {
    return "The file could not be read here, so the firm was not asked whether it holds it. It will be sent as it is.";
  }
  if (row.stage === "skipped") return row.reason ?? "Skipped: its name was already taken.";
  if (row.stage === "cancelled")
    return "Not sent: the upload was cancelled before this file's turn.";
  if (row.stage === "uploading") {
    const sent = formatBytes(row.sentBytes);
    return `${UPLOAD_STAGE_NARRATION.uploading}: ${sent} of ${formatBytes(row.entry.file.size)}.`;
  }
  return UPLOAD_STAGE_NARRATION[row.stage];
}

/**
 * A folder row's standing, as one phrase. Before the transfer reaches anything beneath it, how
 * many of its files are ready — "2 of 3 ready · 1 held"; once it has, how its files are doing.
 */
export function intakeFolderStatus(row: IntakeFolderRow): string {
  if (row.uploaded === 0 && row.failed === 0 && row.inFlight === 0 && row.skipped === 0) {
    if (row.ready === 0 && row.unread === 0 && row.reading === 0) return "Chosen";
    const parts = [`${String(row.ready)} of ${String(row.fileCount)} ready`];
    if (row.held > 0) parts.push(`${String(row.held)} held`);
    if (row.unread > 0) parts.push(`${String(row.unread)} not read`);
    return parts.join(" · ");
  }
  const parts = [`${String(row.uploaded)} of ${String(row.fileCount)} uploaded`];
  if (row.skipped > 0) parts.push(`${String(row.skipped)} skipped`);
  if (row.failed > 0) parts.push(`${String(row.failed)} failed`);
  if (row.inFlight > 0) parts.push(`${String(intakePercent(row.sentBytes, row.totalBytes))}%`);
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
export function intakeColumns(context: {
  readonly filtering: boolean;
  /**
   * Whether the firm has classifications at all. With none defined the column would be a column of
   * blanks with a filter offering nothing, so it is not drawn.
   */
  readonly documentTypes: boolean;
  /**
   * Whether any chosen file's name is already taken where it would land. Like the classification
   * column, the column exists only while there is something to decide in it.
   */
  readonly nameClashes: boolean;
}): GridColumn<IntakeRow>[] {
  return [
    {
      id: "name",
      label: "Name",
      type: "text",
      filter: "set",
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
    /*
     * The classification, where the firm has any. It is left OUT of the model entirely rather than
     * declared hidden when there are none: a column's hidden flag is read once, when the grid is
     * built, so a firm whose types had not finished loading at that moment would have a column it
     * could never see. Absent from the model, it appears the moment the types are in.
     */
    ...(context.documentTypes
      ? [
          {
            id: "documentType",
            label: "Document Type",
            type: "text",
            filter: "set",
            // "None" is the VALUE, not a text override, so the column filter offers it as a
            // choice the reader can actually pick — an untyped file is a thing to select for on
            // this panel, where the whole point of the column is deciding what each file carries.
            value: (row: IntakeRow) =>
              row.kind === "folder" ? "" : row.documentType === "" ? "None" : row.documentType,
          } satisfies GridColumn<IntakeRow>,
        ]
      : []),
    /*
     * The name clash and what the reader chose about it. Only files with a clash have a value; the
     * rest read blank, so the column filter picks out exactly the files that are asking.
     */
    ...(context.nameClashes
      ? [
          {
            id: "nameClash",
            label: "Name Taken",
            type: "text",
            filter: "set",
            filterValues: NAME_CLASH_ORDER.map((choice) => NAME_CLASH_LABEL[choice]),
            value: (row: IntakeRow) =>
              row.kind === "folder" || row.nameClash === null
                ? ""
                : NAME_CLASH_LABEL[row.nameClash],
            text: (row: IntakeRow) =>
              row.kind === "folder" || row.nameClash === null || row.nameTakenBy === null
                ? ""
                : `${NAME_CLASH_LABEL[row.nameClash]} · ${row.nameTakenBy}`,
          } satisfies GridColumn<IntakeRow>,
        ]
      : []),
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
      value: (row) => (row.kind === "folder" ? intakeFolderStatus(row) : intakeFileStatus(row)),
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
