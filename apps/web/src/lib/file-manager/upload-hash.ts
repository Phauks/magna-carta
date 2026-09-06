/*
 * Hashing a file before it is sent, so the firm can be asked whether it already holds the bytes.
 *
 * WHY HASH FIRST. A file the firm already holds — the same brief dropped twice, a folder re-sent
 * after a failed batch, a document that is already on another matter — costs the reader the whole
 * transfer and the matter a duplicate. Hashing first turns that into one small question, and the
 * answer decides whether a byte moves at all. The digest is the browser's own; the server computes
 * its own over the bytes it receives, and only the server's goes into the record.
 *
 * WHY IT STREAMS, AND WHERE. WebCrypto digests a whole buffer at once, and a whole-file buffer is
 * a cost the reader feels past a few hundred megabytes and a tab that may not survive past a few
 * gigabytes; so the file is read in the chunks its stream hands out and fed to an incremental
 * SHA-256, and nothing is held beyond the chunk in hand. A gigabyte takes a few seconds, well under
 * what sending it would take on any link, and a large file is the one whose transfer it most pays
 * to avoid. The digest runs off the main thread, in a Web Worker, so the dialog stays live while a
 * long file is read; where there is no Worker (a test, a browser without one) the same function
 * runs in place. Nothing in the answer changes between the two.
 *
 * A digest in this module is a question, never a fact: a null means "do not ask", and the transfer
 * proceeds as if the question had not been put.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface HashProgressOptions {
  /**
   * Bytes read so far, reported after each chunk; the read waits on what it returns, so a caller
   * that needs the event loop between chunks (the worker does) can take it here.
   */
  readonly onProgress?: (readBytes: number) => void | Promise<void>;
  /** Stops the read; the result is then null. */
  readonly signal?: AbortSignal;
}

/**
 * The SHA-256 of a byte stream as lowercase hex, read once, one chunk in memory at a time; null
 * when the signal aborts before the end. Pure: the worker and the in-place path both call it.
 */
export async function sha256OfStream(
  stream: ReadableStream<Uint8Array>,
  options: HashProgressOptions = {},
): Promise<string | null> {
  const hasher = sha256.create();
  const reader = stream.getReader();
  let readBytes = 0;
  try {
    for (;;) {
      if (options.signal?.aborted === true) {
        await reader.cancel();
        return null;
      }
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      readBytes += value.byteLength;
      await options.onProgress?.(readBytes);
    }
  } finally {
    reader.releaseLock();
  }
  return bytesToHex(hasher.digest());
}

// ---- the worker seam ----------------------------------------------------------------------------

/** What the page sends the worker: a file to read, under a job id. */
export type HashWorkerRequest =
  | { readonly kind: "hash"; readonly id: number; readonly file: File }
  | { readonly kind: "cancel"; readonly id: number };

/** What the worker sends back, under the same id. */
export type HashWorkerReply =
  | { readonly kind: "progress"; readonly id: number; readonly readBytes: number }
  | { readonly kind: "done"; readonly id: number; readonly sha256: string | null }
  | { readonly kind: "failed"; readonly id: number };

interface HashJob {
  readonly onProgress?: (readBytes: number) => void;
  readonly resolve: (sha256: string | null) => void;
}

/**
 * One worker for the tab, made on first use and kept: a batch of five hundred small files would
 * otherwise pay a worker start each. Its jobs run one at a time, which is what one thread does
 * anyway; the upload queue's three lanes wait their turn for the read and overlap on the send.
 */
let worker: Worker | null = null;
let nextJobId = 1;
const jobs = new Map<number, HashJob>();

function workerAvailable(): boolean {
  return typeof Worker === "function" && typeof window !== "undefined";
}

function settleAll(sha256: null): void {
  for (const job of jobs.values()) job.resolve(sha256);
  jobs.clear();
}

function ensureWorker(): Worker {
  if (worker !== null) return worker;
  const made = new Worker(new URL("./upload-hash.worker.ts", import.meta.url), { type: "module" });
  made.onmessage = (event: MessageEvent<HashWorkerReply>) => {
    const reply = event.data;
    const job = jobs.get(reply.id);
    if (job === undefined) return;
    if (reply.kind === "progress") {
      job.onProgress?.(reply.readBytes);
      return;
    }
    jobs.delete(reply.id);
    job.resolve(reply.kind === "done" ? reply.sha256 : null);
  };
  // A worker that dies takes its jobs with it: every waiting question is answered "do not ask",
  // the next file starts a fresh worker, and no upload waits on a thread that is gone.
  made.onerror = () => {
    settleAll(null);
    made.terminate();
    worker = null;
  };
  worker = made;
  return made;
}

function hashInWorker(file: File, options: HashProgressOptions): Promise<string | null> {
  const id = nextJobId;
  nextJobId += 1;
  return new Promise<string | null>((resolve) => {
    const job: HashJob = {
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      resolve,
    };
    jobs.set(id, job);
    const active = ensureWorker();
    options.signal?.addEventListener(
      "abort",
      () => {
        if (!jobs.has(id)) return;
        active.postMessage({ kind: "cancel", id } satisfies HashWorkerRequest);
      },
      { once: true },
    );
    active.postMessage({ kind: "hash", id, file } satisfies HashWorkerRequest);
  });
}

/**
 * The SHA-256 of a file's bytes, or null when the browser cannot read it or the signal stops the
 * read. Null means "do not ask", never "no match": the transfer proceeds as if the question had
 * not been put.
 */
export async function sha256OfFile(
  file: File,
  options: HashProgressOptions = {},
): Promise<string | null> {
  if (options.signal?.aborted === true) return null;
  try {
    if (workerAvailable()) return await hashInWorker(file, options);
    return await sha256OfStream(file.stream(), options);
  } catch {
    return null;
  }
}
