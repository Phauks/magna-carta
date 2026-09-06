/*
 * The hashing worker: reads the files the page hands it, one at a time, and answers each with its
 * SHA-256 and the bytes read along the way. It exists so a long read never sits on the thread the
 * dialog draws on; the digest itself is the same function the page would run in place
 * (upload-hash.ts says why it streams). A cancel for a job still queued drops it unread; one for
 * the job in hand stops the read at the next chunk.
 */
import { sha256OfStream, type HashWorkerReply, type HashWorkerRequest } from "./upload-hash.ts";

const PROGRESS_EVERY_BYTES = 4 * 1024 * 1024;

const queue: Array<{ id: number; file: File }> = [];
const cancelled = new Set<number>();
let draining = false;

// The worker's global is typed as a window by the app's DOM library; the two calls used here are
// the ones both scopes share, and the reply is posted without a target origin.
const scope = self as unknown as {
  postMessage(message: HashWorkerReply): void;
  onmessage: ((event: MessageEvent<HashWorkerRequest>) => void) | null;
};

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = queue.shift();
      if (job === undefined) return;
      if (cancelled.delete(job.id)) {
        scope.postMessage({ kind: "done", id: job.id, sha256: null });
        continue;
      }
      const controller = new AbortController();
      const stopWhenCancelled = (): void => {
        if (cancelled.delete(job.id)) controller.abort();
      };
      let lastReported = 0;
      try {
        const digest = await sha256OfStream(job.file.stream(), {
          signal: controller.signal,
          onProgress: async (readBytes) => {
            // A message per chunk would be a message every few kilobytes; every few megabytes is
            // enough for a percent that moves. The same step gives the event loop a turn: a file
            // stream keeps chunks buffered ahead of the digest, so the read would otherwise run
            // on microtasks to the end and a cancel sent in the meantime would arrive too late.
            if (readBytes - lastReported >= PROGRESS_EVERY_BYTES || readBytes === job.file.size) {
              lastReported = readBytes;
              scope.postMessage({ kind: "progress", id: job.id, readBytes });
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
            stopWhenCancelled();
          },
        });
        scope.postMessage({ kind: "done", id: job.id, sha256: digest });
      } catch {
        scope.postMessage({ kind: "failed", id: job.id });
      }
    }
  } finally {
    draining = false;
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelled.add(request.id);
    return;
  }
  queue.push({ id: request.id, file: request.file });
  void drain();
};
