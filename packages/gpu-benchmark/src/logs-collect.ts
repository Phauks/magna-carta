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
    throw new Error(`fetching benchmark logs from ${url} failed with status ${response.status}`);
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
  for (let attempt = 0; attempt < MAX_LOG_POLL_ATTEMPTS; attempt++) {
    const resultUrl = await client.requestLogsUrl(instanceId);
    const text = await fetchText(resultUrl);
    if (text.includes(COMPLETION_MARKER)) return text;
    if (attempt < MAX_LOG_POLL_ATTEMPTS - 1) {
      await sleep(LOG_POLL_INTERVAL_MILLISECONDS);
    }
  }
  throw new LogCollectionTimeoutError(
    `never observed ${COMPLETION_MARKER} in instance ${instanceId}'s logs after ${MAX_LOG_POLL_ATTEMPTS} attempts`,
  );
};
