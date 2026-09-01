/*
 * Where a saved file lands — the one place every download in the app passes through.
 *
 * THE STATE OF THE WEB, stated plainly because it decides the whole shape of this module. A page
 * cannot choose a folder on its own: only the File System Access API can, and as of this writing
 * Chromium implements it while Firefox and Safari ship only the Origin Private File System, which is
 * a sandboxed store rather than the disk. What Firefox and Safari DO have is the browser's own
 * "always ask where to save" setting, which opens the native dialog for every download — a real
 * local-disk picker, just one the person turns on rather than one this page opens.
 *
 * So this is progressive enhancement over one seam, not a capability we pretend is universal. Where
 * the API exists a member picks a folder once and their files land there. Where it does not, the
 * anchor download runs exactly as before and the browser's own setting governs. Nothing in the app
 * branches on which: every caller says "save this" and gets the best available answer.
 *
 * TWO THINGS THIS DELIBERATELY NEVER DOES.
 *
 * It never fails a download. A missing permission, a folder that has been moved or deleted, a picker
 * that throws — every one of them falls back to the ordinary download rather than costing the member
 * the file they asked for. A folder is a convenience; the file is the point.
 *
 * It never carries the folder off this machine. A FileSystemDirectoryHandle cannot be serialized to a
 * server; it lives in this browser's IndexedDB and nowhere else. That is not a shortcut — it is why
 * the folder choice is per browser while the save-immediately preference is per member: one is a fact
 * about a person, the other is a fact about a machine, and storing either in the other's home would
 * be a lie about what it means.
 */

// The File System Access surface, typed locally: the DOM lib cannot be relied on to carry it while
// two engines do not implement it, and a local declaration keeps this module honest about exactly
// which methods it touches.
type PermissionState = "granted" | "denied" | "prompt";
interface HandlePermissionDescriptor {
  readonly mode: "read" | "readwrite";
}
interface WritableStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  createWritable(): Promise<WritableStream>;
}
interface DirectoryHandle {
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  queryPermission?(descriptor: HandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor: HandlePermissionDescriptor): Promise<PermissionState>;
}
interface PickerWindow {
  showDirectoryPicker?(options?: { mode?: "read" | "readwrite" }): Promise<DirectoryHandle>;
}

const DATABASE_NAME = "mc-downloads";
const STORE_NAME = "handles";
const FOLDER_KEY = "download-folder";

/** Whether THIS browser can let a page choose a folder at all. */
export function folderPickerSupported(): boolean {
  return typeof (globalThis as PickerWindow).showDirectoryPicker === "function";
}

// A handle is a live object rather than data, so IndexedDB is the only store that can hold one —
// localStorage takes strings. Everything here resolves rather than throws: a browser refusing
// storage (a private window, blocked site data) means "no folder", never a broken download.
function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readStoredFolder(): Promise<DirectoryHandle | null> {
  const database = await openDatabase();
  if (database === null) return null;
  return await new Promise((resolve) => {
    try {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(FOLDER_KEY);
      request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeStoredFolder(handle: DirectoryHandle | null): Promise<void> {
  const database = await openDatabase();
  if (database === null) return;
  await new Promise<void>((resolve) => {
    try {
      const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
      const request = handle === null ? store.delete(FOLDER_KEY) : store.put(handle, FOLDER_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** The chosen folder's name for the settings row, or null when none is chosen or reachable. */
export async function chosenFolderName(): Promise<string | null> {
  const handle = await readStoredFolder();
  return handle?.name ?? null;
}

/**
 * Ask the member for a folder. MUST be called straight from a click: the picker needs transient
 * user activation, and an await before it spends that activation. Resolves to the folder's name, or
 * null when the member cancelled or the browser cannot ask.
 */
export async function chooseDownloadFolder(): Promise<string | null> {
  const picker = (globalThis as PickerWindow).showDirectoryPicker;
  if (picker === undefined) return null;
  try {
    const handle = await picker.call(globalThis, { mode: "readwrite" });
    await writeStoredFolder(handle);
    return handle.name;
  } catch {
    // Cancelling the picker throws; that is an answer, not a failure.
    return null;
  }
}

export async function forgetDownloadFolder(): Promise<void> {
  await writeStoredFolder(null);
}

// Permission can lapse between sessions, and re-granting needs a gesture this module may no longer
// hold — a save happens after a render, and a render can be a network round trip. So a lapsed
// permission is simply not a folder any more, and the ordinary download runs.
async function folderReadyForWriting(handle: DirectoryHandle): Promise<boolean> {
  try {
    const state = (await handle.queryPermission?.({ mode: "readwrite" })) ?? "granted";
    if (state === "granted") return true;
    if (state === "denied") return false;
    return ((await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied") === "granted";
  } catch {
    return false;
  }
}

/** The ordinary download every browser has always done: the browser's own settings decide the folder. */
function saveThroughBrowser(content: string | Blob, filename: string, contentType: string): void {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type: contentType }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Save a file. Writes into the member's chosen folder when this browser can and the folder is still
 * reachable; otherwise hands it to the browser exactly as before.
 *
 * Resolves to where it went, so a caller can tell the member which happened without deciding it.
 */
export async function saveToTarget(
  content: string | Blob,
  filename: string,
  contentType: string,
): Promise<"folder" | "browser"> {
  const handle = await readStoredFolder();
  if (handle !== null && (await folderReadyForWriting(handle))) {
    try {
      const file = await handle.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(
        content instanceof Blob ? content : new Blob([content], { type: contentType }),
      );
      await writable.close();
      return "folder";
    } catch {
      // The folder moved, was deleted, or the write was refused. The file still has to arrive.
      saveThroughBrowser(content, filename, contentType);
      return "browser";
    }
  }
  saveThroughBrowser(content, filename, contentType);
  return "browser";
}
