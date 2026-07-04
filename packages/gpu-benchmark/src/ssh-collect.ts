import { execFile } from "node:child_process";

import type { CollectFn } from "./run.ts";

/**
 * Bounded retry budget for reading the benchmark result off a rented instance: attempts * interval
 * is the ceiling on how long a hung or slow-starting benchmark keeps the instance rented (and
 * billing) before the collector gives up and lets `benchmarkOneRig`'s `finally` tear it down.
 */
const MAX_READ_ATTEMPTS = 40;
const READ_INTERVAL_MILLISECONDS = 15000;

/** Bounded time for a single `ssh` invocation, so one hung connection attempt cannot stall a whole poll cycle. */
const SSH_COMMAND_TIMEOUT_MILLISECONDS = 20000;

const REMOTE_RESULT_PATH = "/result.json";
const REMOTE_USER = "root";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs `ssh -p <port> -o StrictHostKeyChecking=accept-new root@<host> cat /result.json` and
 * resolves with stdout, or rejects if the command exits non-zero (the file does not exist yet, the
 * connection is refused because the instance is still booting, etc).
 *
 * `StrictHostKeyChecking=accept-new` trusts the host key on first connect without prompting, which
 * is appropriate here because each rented instance is a fresh, disposable host with no prior
 * known-hosts entry — there is no interactive terminal to answer a host-key prompt from a CLI run.
 *
 * This assumes the caller's environment already has an SSH key vast.ai has been given the public
 * half of (vast.ai injects authorized keys onto rented instances based on account settings) — that
 * setup, along with the exact remote path and timing, is validated and adjusted against the first
 * real rented instance; there is no local way to exercise a real SSH round trip in this repo.
 */
function readRemoteFile(sshHost: string, sshPort: number, remotePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      [
        "-p",
        String(sshPort),
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "BatchMode=yes",
        `${REMOTE_USER}@${sshHost}`,
        "cat",
        remotePath,
      ],
      { timeout: SSH_COMMAND_TIMEOUT_MILLISECONDS },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `ssh cat ${remotePath} on ${sshHost}:${sshPort} failed: ${stderr || error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * The real `CollectFn` (see `run.ts`): SSHes to the rented instance and polls `cat /result.json`
 * until the output parses as JSON, then returns the raw text for `benchmarkOneRig` to hand to
 * `parseBenchmarkJson`.
 *
 * The benchmark image's `onstart` command writes its result to `/result.json` and then
 * `sleep infinity`s so the box stays SSH-reachable for this poll — see `cli.ts`'s
 * `BENCHMARK_ONSTART_COMMAND`. Polling (rather than a single read) tolerates the gap between the
 * instance reporting `running` (SSH is up) and the benchmark container finishing and flushing the
 * result file.
 *
 * Best-effort and not unit-testable here: it needs a real rented instance to exercise. Exact
 * timing, the remote path, and the SSH key/host-key setup are validated and adjusted at the first
 * real benchmark run.
 */
export const collectViaSsh: CollectFn = async ({ sshHost, sshPort }) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
    try {
      const raw = await readRemoteFile(sshHost, sshPort, REMOTE_RESULT_PATH);
      JSON.parse(raw); // throws if the file is empty, truncated, or still being written
      return raw;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_READ_ATTEMPTS - 1) {
        await sleep(READ_INTERVAL_MILLISECONDS);
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `never read a valid JSON result from ${sshHost}:${sshPort}${REMOTE_RESULT_PATH} after ${MAX_READ_ATTEMPTS} attempts: ${detail}`,
  );
};
