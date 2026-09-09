/*
 * The digest register — every chosen file's SHA-256, read while the reader is still deciding.
 *
 * WHY IT IS NOT THE QUEUE'S. The digest answers one question ("does the firm already hold these
 * bytes?") and the answer decides whether a byte moves at all, so it has to be in hand BEFORE a
 * file's turn comes. Read inside the upload lane, it was not: three lanes each stopped at their own
 * file to read it end to end, and a gigabyte of reading happened while the connection sat idle.
 * Reading starts the moment a file is chosen instead — the panel is open, nothing is being sent,
 * and the read costs the reader nothing they can feel. By the time Upload is pressed most digests
 * are already answered, and the ones that are not are being read while the earlier files send.
 *
 * ONE READ PER FILE, EVER. The register is keyed by the intake key (path, name, size, device date),
 * so the same file chosen twice, sent twice, or retried after a failure is read once. A promise is
 * stored rather than a value, so a caller arriving mid-read waits on the read in progress instead
 * of starting a second one.
 *
 * READS ARE SERIAL. There is one hashing worker for the tab; handing it five hundred files at once
 * would queue five hundred messages and report progress on all of them at once while finishing
 * none. One at a time, in the order they were chosen, means the first file is ready first — which
 * is the file the first upload lane asks for.
 *
 * A NULL IS "DO NOT ASK", NEVER "NO MATCH". A read that fails or is abandoned answers null, and the
 * upload proceeds as though the question had not been put.
 */
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import { intakeEntryKey } from "./upload-intake.ts";
import { sha256OfFile } from "./upload-hash.ts";

interface DigestRecord {
  readonly promise: Promise<string | null>;
  readonly controller: AbortController;
  /** Who is watching this read as it goes — an upload lane that reached the file mid-read. */
  readonly listeners: Set<(bytes: number) => void>;
}

const records = new Map<string, DigestRecord>();
/** Bytes read so far per key, for the rows that report a read in progress. */
let readBytes = $state<Record<string, number>>({});
/** Keys whose read has answered — the rows that no longer report anything. */
let settled = $state<ReadonlySet<string>>(new Set());

/** The reads run one behind another; this is the tail of that chain. */
let queue: Promise<unknown> = Promise.resolve();

/** How the file is read. A seam so a test names its own digest without a worker. */
let readDigest: (
  file: File,
  options: { onProgress: (bytes: number) => void; signal: AbortSignal },
) => Promise<string | null> = sha256OfFile;

function start(key: string, entry: DroppedEntry): DigestRecord {
  const controller = new AbortController();
  const listeners = new Set<(bytes: number) => void>();
  const promise = queue.then(async (): Promise<string | null> => {
    if (controller.signal.aborted) return null;
    const digest = await readDigest(entry.file, {
      onProgress: (bytes) => {
        readBytes = { ...readBytes, [key]: bytes };
        for (const listener of listeners) listener(bytes);
      },
      signal: controller.signal,
    });
    settled = new Set([...settled, key]);
    return digest;
  });
  // The chain must not break on a read that threw: the files behind it are still waiting.
  queue = promise.catch(() => null);
  const record = { promise, controller, listeners };
  records.set(key, record);
  return record;
}

/** Begin reading everything chosen that has not been read, in the order it was chosen. */
export function beginDigests(entries: readonly DroppedEntry[]): void {
  for (const entry of entries) {
    const key = intakeEntryKey(entry);
    if (records.has(key)) continue;
    start(key, entry);
  }
}

/**
 * The file's digest, waiting on a read already running or starting one now.
 *
 * `onProgress` follows a read still in flight and is called at once with what has been read so
 * far, so a caller that arrives mid-read reports from where the read actually is rather than from
 * zero. `signal` stops the WATCHING, never the read: the read belongs to the register and another
 * caller — a retry, a second batch over the same file — is entitled to its answer.
 */
export function digestOf(
  entry: DroppedEntry,
  options: {
    readonly onProgress?: (bytes: number) => void;
    readonly signal?: AbortSignal;
  } = {},
): Promise<string | null> {
  const key = intakeEntryKey(entry);
  const record = records.get(key) ?? start(key, entry);
  const { onProgress, signal } = options;
  if (onProgress !== undefined) {
    record.listeners.add(onProgress);
    onProgress(readBytes[key] ?? 0);
    const stop = (): void => {
      record.listeners.delete(onProgress);
    };
    signal?.addEventListener("abort", stop, { once: true });
    void record.promise.then(stop, stop);
  }
  return record.promise;
}

/** Bytes read so far for a chosen file, for the row that reports the read. */
export function digestReadBytes(key: string): number {
  return readBytes[key] ?? 0;
}

/** Whether the file's read has answered — the row then reports nothing about reading. */
export function digestSettled(key: string): boolean {
  return settled.has(key);
}

/**
 * Abandon and forget the given files' reads — a file removed from the intake, or a whole intake
 * discarded. Called with nothing, forgets every read the tab holds.
 */
export function forgetDigests(keys?: Iterable<string>): void {
  const wanted = keys === undefined ? [...records.keys()] : [...keys];
  const dropped = new Set(wanted);
  for (const key of wanted) {
    records.get(key)?.controller.abort();
    records.delete(key);
  }
  readBytes = Object.fromEntries(Object.entries(readBytes).filter(([key]) => !dropped.has(key)));
  settled = new Set([...settled].filter((key) => !dropped.has(key)));
}

/** For tests: name the read, and start from an empty register. */
export function resetDigestsForTests(read: typeof readDigest = sha256OfFile): void {
  forgetDigests();
  queue = Promise.resolve();
  readDigest = read;
}
