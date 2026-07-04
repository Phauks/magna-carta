import type { CollectFn } from "./run.ts";
import type { VastClient } from "./vast-client.ts";

/**
 * Bounded retry budget for polling vast.ai's logs API for the benchmark's completion marker:
 * attempts * interval is the ceiling on how long a hung or slow-starting benchmark keeps the
 * instance rented (and billing) before the collector gives up and lets `benchmarkOneRig`'s
 * retry loop fall through to the next offer.
 */
const MAX_LOG_POLL_ATTEMPTS = 15;
const LOG_POLL_INTERVAL_MILLISECONDS = 15000;

/**
 * How long to wait between asking vast.ai to capture the instance's stdout (`requestLogsUrl`, a
 * `PUT`) and fetching the resulting S3 object. vast.ai uploads the capture **asynchronously**, so
 * a `GET` issued immediately after the request races the upload and returns 403 (S3 AccessDenied
 * on a not-yet-existent object). Confirmed live: with no delay every fetch 403s; vast.ai's own
 * guidance is to wait for logs to become available after requesting them. This settle window,
 * inside the bounded poll loop, is what lets the fetch land after the upload completes.
 */
const LOG_UPLOAD_SETTLE_MILLISECONDS = 8000;

/** The onstart command's final echo (see cli.ts's `BENCHMARK_ONSTART_COMMAND`) — its presence in the collected log means the benchmark ran to completion. */
const COMPLETION_MARKER = "BENCH_END";

/** Thrown when the benchmark's completion marker never appears in the collected logs within the poll budget. */
export class LogCollectionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogCollectionTimeoutError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    // Deliberately omit `url`: it is a vast.ai presigned S3 link whose query string is a bearer
    // capability to the instance's captured stdout. Logging it (this message reaches the CLI's
    // console.error) would leak that capability — harmless for a benchmark's nvidia-smi output,
    // but this same collection path captures a real hash-crack run's stdout in production.
    throw new Error(`fetching benchmark logs failed with status ${response.status}`);
  }
  return response.text();
}

/**
 * The real `CollectFn` (see `run.ts`): polls vast.ai's logs API — `PUT
 * /api/v0/instances/request_logs/{id}/` returns an S3 `result_url`, which is then fetched
 * directly — until the onstart benchmark's completion marker appears in the captured stdout,
 * then returns the raw text for `benchmarkOneRig` to hand to `parseBenchmarkLog`.
 *
 * Unlike the retired SSH collector, this needs no SSH key on either side — the logs API reads
 * the container's stdout directly. This is also why the onstart command no longer needs a
 * trailing `sleep infinity`: renting with `runtype: "ssh"` already keeps the instance's sshd
 * process (and therefore the instance itself) alive once the benchmark command exits.
 */
export const collectViaLogs: CollectFn = async (
  client: VastClient,
  instanceId: number,
): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_LOG_POLL_ATTEMPTS; attempt++) {
    try {
      const resultUrl = await client.requestLogsUrl(instanceId);
      // Let vast.ai finish uploading the freshly-requested capture to S3 before fetching it —
      // fetching immediately races the async upload and 403s every time (see
      // LOG_UPLOAD_SETTLE_MILLISECONDS). A fresh capture is requested each iteration so the fetched
      // log reflects the benchmark's latest progress, not a stale snapshot from before it finished.
      await sleep(LOG_UPLOAD_SETTLE_MILLISECONDS);
      const text = await fetchText(resultUrl);
      if (text.includes(COMPLETION_MARKER)) return text;
    } catch (error) {
      // Any residual transient failure (a slower-than-usual upload, a 5xx) is "not ready yet", not
      // a dead rig — swallow it and keep polling within the bounded budget rather than discarding
      // an otherwise-healthy rented instance (which would force benchmarkOneRig to re-rent a fresh
      // offer and burn money for nothing).
      lastError = error;
    }
    if (attempt < MAX_LOG_POLL_ATTEMPTS - 1) {
      await sleep(LOG_POLL_INTERVAL_MILLISECONDS);
    }
  }
  const detail = lastError instanceof Error ? ` (last error: ${lastError.message})` : "";
  throw new LogCollectionTimeoutError(
    `never observed ${COMPLETION_MARKER} in instance ${instanceId}'s logs after ${MAX_LOG_POLL_ATTEMPTS} attempts${detail}`,
  );
};
