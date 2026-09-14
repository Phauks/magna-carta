/*
 * The digest register — every chosen file's SHA-256, read while the reader is still deciding, and
 * the firm's answer to it.
 *
 * WHY IT IS NOT THE QUEUE'S. The digest answers one question ("does the firm already hold these
 * bytes?") and the answer decides whether a byte moves at all, so it has to be in hand BEFORE a
 * file's turn comes. Read inside the upload lane, it was not: three lanes each stopped at their own
 * file to read it end to end, and a gigabyte of reading happened while the connection sat idle.
 * Reading starts the moment a file is chosen instead — the panel is open, nothing is being sent,
 * and the read costs the reader nothing they can feel. By the time Upload is pressed most digests
 * are already answered, and the ones that are not are being read while the earlier files send.
 *
 * READINESS IS THE HASH, AND THE FIRM'S ANSWER TO IT. The reader is told, per file and before the
 * press, whether it is ready to go: still being read, read and ready, read and found to be bytes
 * the firm already holds (so nothing will be sent for it), or not readable here. The register asks
 * the firm as soon as a digest is in, because "held" is the one readiness a reader wants to know
 * before deciding — a folder that is mostly held costs nothing to send, and a reader who can see
 * that presses Upload without a second thought. The question is always asked; there is no setting
 * that turns it off, because a file the firm already holds is never sent again.
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
 * upload proceeds as though the question had not been put. The firm's answer is the same way
 * round: a host that cannot answer costs nothing but the file reading as ready.
 */
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import { findUploadMatches } from "$lib/documents/document-api.ts";
import { intakeEntryKey, type IntakeProgress } from "./upload-intake.ts";
import { sha256OfFile } from "./upload-hash.ts";

interface DigestRecord {
  readonly promise: Promise<string | null>;
  readonly controller: AbortController;
  /** Who is watching this read as it goes — an upload lane that reached the file mid-read. */
  readonly listeners: Set<(bytes: number) => void>;
}

/**
 * What the register knows about a file once its read has answered: ready to be sent, held by the
 * firm already (nothing will be sent for it), or not readable here.
 */
export type DigestReadiness = "ready" | "held" | "unread";

const records = new Map<string, DigestRecord>();
/** Bytes read so far per key, for the rows that report a read in progress. */
let readBytes = $state<Record<string, number>>({});
/** Keys whose read has answered — the rows that no longer report anything about reading. */
let settled = $state<ReadonlySet<string>>(new Set());
/** Each answered file's readiness, once the firm has been asked (or could not be). */
let readiness = $state<Record<string, DigestReadiness>>({});

/** The reads run one behind another; this is the tail of that chain. */
let queue: Promise<unknown> = Promise.resolve();

/** How the file is read. A seam so a test names its own digest without a worker. */
let readDigest: (
  file: File,
  options: { onProgress: (bytes: number) => void; signal: AbortSignal },
) => Promise<string | null> = sha256OfFile;

/**
 * Whether the firm holds these bytes anywhere — on the matter the file is bound for or on any
 * other — as the register asks it: true, false, or null when the host could not answer. Answered
 * for the matter the file was bound for when it was chosen; "held" is a fact about the firm, so a
 * destination changed afterwards does not change it. A seam for the same reason the read is one.
 */
export type FirmHoldsQuestion = (input: {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly matterId: string;
}) => Promise<boolean | null>;

async function askFirmOverTheApi(input: {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly matterId: string;
}): Promise<boolean | null> {
  const matches = await findUploadMatches(fetch, input);
  if (matches.kind !== "ok") return null;
  return matches.value.onMatter.length > 0 || matches.value.elsewhere.length > 0;
}

let askFirm: FirmHoldsQuestion = askFirmOverTheApi;

function start(key: string, entry: DroppedEntry, matterId: string): DigestRecord {
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
    // The firm's answer is asked off the chain: the next file's read need not wait on a round trip.
    void settleReadiness(key, digest, entry.file.size, matterId, controller.signal);
    return digest;
  });
  // The chain must not break on a read that threw: the files behind it are still waiting.
  queue = promise.catch(() => null);
  const record = { promise, controller, listeners };
  records.set(key, record);
  return record;
}

async function settleReadiness(
  key: string,
  digest: string | null,
  sizeBytes: number,
  matterId: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  if (digest === null) {
    readiness = { ...readiness, [key]: "unread" };
    return;
  }
  let held: boolean | null = null;
  try {
    held = await askFirm({ sha256: digest, sizeBytes, matterId });
  } catch {
    held = null;
  }
  // The read was forgotten while the firm was being asked: the file is no longer chosen.
  if (signal.aborted || !records.has(key)) return;
  readiness = { ...readiness, [key]: held === true ? "held" : "ready" };
}

/**
 * Begin reading everything chosen that has not been read, in the order it was chosen. The matter
 * is the one the files are bound for right now, which is what the firm is asked against.
 */
export function beginDigests(entries: readonly DroppedEntry[], matterId: string): void {
  for (const entry of entries) {
    const key = intakeEntryKey(entry);
    if (records.has(key)) continue;
    start(key, entry, matterId);
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
    /** The matter to ask the firm against, where this call is the one that starts the read. */
    readonly matterId?: string;
  } = {},
): Promise<string | null> {
  const key = intakeEntryKey(entry);
  const record = records.get(key) ?? start(key, entry, options.matterId ?? "");
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

/** The file's readiness once the firm has been asked; undefined while it is still being read or asked. */
export function digestReadiness(key: string): DigestReadiness | undefined {
  return readiness[key];
}

/**
 * Where every chosen file stands before the press, keyed the way the table keys its rows — the
 * same shape a running batch reports, so the Status column reads one vocabulary throughout. A file
 * whose read has not begun reports nothing: it is chosen, and that is all.
 */
export function intakeReadiness(
  entries: readonly DroppedEntry[],
): ReadonlyMap<string, IntakeProgress> {
  const progress = new Map<string, IntakeProgress>();
  for (const entry of entries) {
    const key = intakeEntryKey(entry);
    const known = readiness[key];
    if (known !== undefined) {
      progress.set(key, { stage: known });
      continue;
    }
    const read = readBytes[key] ?? 0;
    if (read === 0 && !settled.has(key)) continue;
    // Read, and being asked about: the read reports as complete until the firm's answer is in.
    progress.set(key, {
      stage: "hashing",
      hashedBytes: settled.has(key) ? entry.file.size : read,
    });
  }
  return progress;
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
  readiness = Object.fromEntries(Object.entries(readiness).filter(([key]) => !dropped.has(key)));
}

/** For tests: name the read and the firm's answer, and start from an empty register. */
export function resetDigestsForTests(
  read: typeof readDigest = sha256OfFile,
  ask: FirmHoldsQuestion = askFirmOverTheApi,
): void {
  forgetDigests();
  queue = Promise.resolve();
  readDigest = read;
  askFirm = ask;
}
