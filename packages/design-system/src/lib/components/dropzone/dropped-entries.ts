/*
 * What a drop or a pick actually contained, file by file, each with the path it arrived under.
 *
 * A browser reports a dropped FOLDER as one zero-byte File carrying the folder's name, which is
 * worse than nothing: a consumer that takes `dataTransfer.files` at face value uploads a stub named
 * after the folder and never sees what was inside it. The folder's contents are reachable only
 * through the entry API (`DataTransferItem.webkitGetAsEntry`), which has to be walked. That walk
 * lives here, in one place, so every surface that welcomes a folder gets the same answer.
 *
 * The path convention is the one the platform's own folder picker already speaks
 * (`input.webkitRelativePath`): the folder's own name first, then each level beneath it, then the
 * file — "Discovery/2024/letter.pdf" — and an EMPTY path for a file that arrived on its own. So a
 * consumer reads the folder to recreate from everything before the last slash, and needs no second
 * rule for the picked-versus-dropped case.
 */

export interface DroppedEntry {
  readonly file: File;
  /** "Folder/sub/name.ext" for a file inside a folder; "" for a file that arrived on its own. */
  readonly relativePath: string;
}

/** The folder part of an entry's path — "Folder/sub" — or "" when the file arrived on its own. */
export function folderPathOf(entry: Pick<DroppedEntry, "relativePath">): string {
  const cut = entry.relativePath.lastIndexOf("/");
  return cut === -1 ? "" : entry.relativePath.slice(0, cut);
}

/** The files a native picker answered, with the path each carries when the pick was a folder. */
export function entriesFromFileList(files: Iterable<File>): DroppedEntry[] {
  return Array.from(files, (file) => ({ file, relativePath: file.webkitRelativePath ?? "" }));
}

/** The subset of the File System Entry API this walk needs, narrowed so a test can stand in for it. */
export interface EntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  file?: (resolve: (file: File) => void, reject: (reason: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      resolve: (entries: EntryLike[]) => void,
      reject: (reason: unknown) => void,
    ) => void;
  };
}

async function walk(entry: EntryLike, folderPath: string, out: DroppedEntry[]): Promise<void> {
  if (entry.isFile && entry.file !== undefined) {
    const read = entry.file;
    const file = await new Promise<File>((resolve, reject) => read(resolve, reject));
    out.push({ file, relativePath: folderPath === "" ? "" : `${folderPath}/${entry.name}` });
    return;
  }
  if (!entry.isDirectory || entry.createReader === undefined) return;
  const reader = entry.createReader();
  const below = folderPath === "" ? entry.name : `${folderPath}/${entry.name}`;
  // readEntries answers in batches and an empty batch means the end; one call is not the listing.
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, below, out);
  }
}

/**
 * Every file a drop contained, folders walked. Falls back to the flat file list where the entry API
 * is absent (an older engine, or a synthetic drop in a test), which is the pre-existing behaviour.
 */
export async function entriesFromDataTransfer(transfer: DataTransfer): Promise<DroppedEntry[]> {
  const items = Array.from(transfer.items ?? []);
  const entries = items
    .map((item) => (item.kind === "file" ? (item.webkitGetAsEntry() as EntryLike | null) : null))
    .filter((entry): entry is EntryLike => entry !== null);
  if (entries.length === 0) return entriesFromFileList(transfer.files);
  const out: DroppedEntry[] = [];
  for (const entry of entries) await walk(entry, "", out);
  return out;
}

/*
 * THE PICKER PATH, AND WHY IT IS NOT AN <input type="file">.
 *
 * A folder chosen through `<input webkitdirectory>` makes the browser raise its own confirmation
 * over the top of ours — "Upload 240 files to this site?" — which is a second question about a
 * choice the reader has already made, in a dialog we do not control and cannot word. The file
 * picker of the File System Access API asks nothing of the sort: choosing files raises no
 * confirmation at all, and choosing a folder asks once for permission to READ it, which is a
 * different and honest question. So where the API exists the pickers below are the way in, and the
 * hidden inputs remain only as the fallback for an engine that has not got it.
 *
 * The handle types are declared here rather than taken from the DOM library, which does not yet
 * carry them: only the members this walk touches, so a browser without them is a `undefined` check
 * rather than a type error.
 */

interface FileSystemHandleLike {
  readonly kind: "file" | "directory";
  readonly name: string;
}

export interface FileHandleLike extends FileSystemHandleLike {
  readonly kind: "file";
  getFile: () => Promise<File>;
}

export interface DirectoryHandleLike extends FileSystemHandleLike {
  readonly kind: "directory";
  values: () => AsyncIterable<FileHandleLike | DirectoryHandleLike>;
}

interface FilePickerWindow {
  showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileHandleLike[]>;
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
}

/** Whether this engine has the file picker that asks no confirmation of its own. */
export function nativeFilePickerAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const picker = window as unknown as FilePickerWindow;
  return typeof picker.showOpenFilePicker === "function";
}

/** Whether this engine has the directory picker. Chromium has both; the two ship together. */
export function nativeDirectoryPickerAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const picker = window as unknown as FilePickerWindow;
  return typeof picker.showDirectoryPicker === "function";
}

/** The files behind picked file handles, each on its own — a picked file belongs to no folder. */
export async function entriesFromFileHandles(
  handles: readonly FileHandleLike[],
): Promise<DroppedEntry[]> {
  const entries: DroppedEntry[] = [];
  for (const handle of handles) entries.push({ file: await handle.getFile(), relativePath: "" });
  return entries;
}

/**
 * Every file under a picked directory, walked, each carrying the path convention the rest of this
 * module speaks: the picked folder's own name first, then each level beneath it.
 */
export async function entriesFromDirectoryHandle(
  handle: DirectoryHandleLike,
): Promise<DroppedEntry[]> {
  const entries: DroppedEntry[] = [];
  const walkHandle = async (directory: DirectoryHandleLike, folderPath: string): Promise<void> => {
    for await (const child of directory.values()) {
      const path = folderPath === "" ? child.name : `${folderPath}/${child.name}`;
      if (child.kind === "file") entries.push({ file: await child.getFile(), relativePath: path });
      else await walkHandle(child, path);
    }
  };
  await walkHandle(handle, handle.name);
  return entries;
}

/**
 * Ask for files through the native picker. An empty answer is a reader who cancelled, which is not
 * a failure and is reported the same way as one: nothing was chosen.
 */
export async function pickFiles(): Promise<DroppedEntry[]> {
  const picker = window as unknown as FilePickerWindow;
  if (picker.showOpenFilePicker === undefined) return [];
  try {
    return await entriesFromFileHandles(await picker.showOpenFilePicker({ multiple: true }));
  } catch {
    return [];
  }
}

/** Ask for one folder through the native picker, and answer with everything inside it. */
export async function pickFolder(): Promise<DroppedEntry[]> {
  const picker = window as unknown as FilePickerWindow;
  if (picker.showDirectoryPicker === undefined) return [];
  try {
    return await entriesFromDirectoryHandle(await picker.showDirectoryPicker({ mode: "read" }));
  } catch {
    return [];
  }
}
