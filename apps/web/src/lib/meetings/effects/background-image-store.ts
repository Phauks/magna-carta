/*
 * The picture a member chose to stand in front of, kept in this browser and nowhere else.
 *
 * PER BROWSER, FOR THE REASON THE REST OF THE EFFECTS CHOICE IS (meeting-effects-preference.svelte.ts):
 * whether a background can be replaced at all is a fact about this machine. It is also never sent
 * anywhere. The room sees the composite; the picture itself does not leave the member's browser.
 *
 * IN INDEXEDDB, NOT LOCAL STORAGE. A photograph is hundreds of kilobytes, which local storage holds
 * badly or not at all, and IndexedDB keeps a `Blob` as it is. The picture is cut down before it is
 * kept, so a forty-megapixel photograph costs the same as a screenshot.
 *
 * EVERY FAILURE IS AN ABSENCE. A private window, a browser that refuses storage, or a picture that no
 * longer decodes reads as "no picture chosen"; the member is then asked to choose one, and is never
 * left without a camera because a store would not open.
 */

const DATABASE = "magna-carta-meeting-effects";
const STORE = "background";
const KEY = "image";

/**
 * The largest picture kept. A camera sends at most this; anything larger is detail the room never
 * sees, kept at the cost of space and decode time on every join.
 */
export const BACKGROUND_IMAGE_MAX_WIDTH = 1920;
export const BACKGROUND_IMAGE_MAX_HEIGHT = 1080;

/** The size a picture is cut down to: its own shape, no larger than the limits above. */
export function fittedSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    BACKGROUND_IMAGE_MAX_WIDTH / width,
    BACKGROUND_IMAGE_MAX_HEIGHT / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("storage")));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = act(database.transaction(STORE, mode).objectStore(STORE));
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error ?? new Error("storage")));
    });
  } finally {
    database.close();
  }
}

/**
 * Decode, cut down and keep a chosen picture, and answer it ready to draw. Rejects only where the
 * file is not a picture this browser can decode; a store that will not keep it still answers the
 * picture, so it works for this meeting even where it cannot be remembered.
 */
export async function keepBackgroundImage(file: Blob): Promise<ImageBitmap> {
  const decoded = await createImageBitmap(file);
  const size = fittedSize(decoded.width, decoded.height);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    decoded.close();
    throw new Error("graphics");
  }
  context.drawImage(decoded, 0, 0, size.width, size.height);
  decoded.close();
  const kept = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  try {
    await withStore("readwrite", (store) => store.put(kept, KEY));
  } catch {
    // Not remembered, which the member finds out next time; this meeting still has its picture.
  }
  return createImageBitmap(kept);
}

/** The picture this browser remembers, ready to draw, or null where there is none. */
export async function loadBackgroundImage(): Promise<ImageBitmap | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const kept: unknown = await withStore("readonly", (store) => store.get(KEY));
    if (!(kept instanceof Blob)) return null;
    return await createImageBitmap(kept);
  } catch {
    return null;
  }
}
