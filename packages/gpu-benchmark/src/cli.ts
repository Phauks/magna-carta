import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { BENCHMARK_SHORTLIST, type RigShape } from "./offer-filter.ts";
import type { RigProfile } from "./profiles.ts";
import { upsertProfile } from "./profiles.ts";
import { benchmarkOneRig } from "./run.ts";
import { collectViaSsh } from "./ssh-collect.ts";
import { createVastClient, type VastClient } from "./vast-client.ts";

/**
 * The command each rented instance runs on boot: runs the benchmark script, sending its result to
 * a file the SSH collector polls for and its log output to a separate file for after-the-fact
 * diagnosis, then keeps the instance alive so it stays SSH-reachable once the benchmark exits —
 * vast.ai otherwise recycles an instance whose onstart command finishes.
 */
export const BENCHMARK_ONSTART_COMMAND =
  "/opt/recovery-gpu/bench/run-benchmark.sh > /result.json 2>/benchmark.log; sleep infinity";

/** Resolved relative to this file so the CLI finds the profiles table regardless of the caller's working directory. */
const RIG_PROFILES_URL = new URL(
  "../../../docs/research/gpu-recovery/rig-profiles.json",
  import.meta.url,
);

interface RigProfilesFile {
  generatedAt: string | null;
  profiles: RigProfile[];
}

interface ParsedArgs {
  readonly image: string;
  readonly gpu: string | undefined;
}

/** Thrown for a malformed or incomplete command line — never a benchmark or vast.ai failure. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * Parses `--image <ref>` (required) and `--gpu <name>` (optional). Anything else on the command
 * line is ignored rather than rejected, so this stays a thin driver rather than a general-purpose
 * argument parser.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let image: string | undefined;
  let gpu: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--image") {
      image = argv[index + 1];
      index++;
    } else if (token === "--gpu") {
      gpu = argv[index + 1];
      index++;
    }
  }
  if (image === undefined || image === "") {
    throw new CliUsageError("--image <ref> is required");
  }
  return { image, gpu };
}

/**
 * Selects the shortlist entries to benchmark: the whole shortlist, or — when `--gpu` names a GPU —
 * every shortlist entry for that GPU (the shortlist lists the same GPU at more than one count, e.g.
 * RTX_4090 x1/x2/x4, so naming the GPU alone can still mean more than one rig shape).
 */
export function selectTargets(
  shortlist: ReadonlyArray<RigShape>,
  gpuName: string | undefined,
): RigShape[] {
  if (gpuName === undefined) return [...shortlist];
  const matches = shortlist.filter(
    (entry) => entry.gpuName.toLowerCase() === gpuName.toLowerCase(),
  );
  if (matches.length === 0) {
    const known = shortlist.map((entry) => entry.gpuName).join(", ");
    throw new CliUsageError(`--gpu ${gpuName} matches no shortlist entry (known GPUs: ${known})`);
  }
  return matches;
}

async function loadRigProfiles(): Promise<RigProfilesFile> {
  const raw = await readFile(RIG_PROFILES_URL, "utf8");
  return JSON.parse(raw) as RigProfilesFile;
}

async function saveRigProfiles(file: RigProfilesFile): Promise<void> {
  await writeFile(RIG_PROFILES_URL, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/** Every instance `benchmarkOneRig` rents carries this label prefix (see `run.ts`'s `createInstance` call). */
const BENCHMARK_LABEL_PREFIX = "gpu-benchmark-";

/**
 * Billing backstop for the window between a rented instance existing on vast.ai's side and its id
 * reaching `benchmarkOneRig`'s local bookkeeping: if `createInstance`'s response is lost or fails
 * validation after vast.ai has already provisioned the rig, the instance id never reaches the
 * `finally` block that would otherwise destroy it, and it bills with nothing local tracking it.
 *
 * This sweeps every live vast.ai instance labeled as a benchmark rig and destroys it, independent of
 * which run (or invocation) created it — the label is deterministic (`gpu-benchmark-<gpuName>-
 * <gpuCount>`), so any instance carrying it is benchmark spend that should not still be running once
 * the sweep completes. `destroyInstance` treats a 404 as success, so destroying an instance that
 * `benchmarkOneRig` already cleaned up itself is harmless.
 */
export async function reconcileLeakedInstances(client: VastClient): Promise<void> {
  const instances = await client.listInstances();
  for (const instance of instances) {
    if (!instance.label.startsWith(BENCHMARK_LABEL_PREFIX)) continue;
    console.log(
      `reconcile: destroying leaked benchmark instance ${instance.instanceId} (${instance.label})`,
    );
    await client.destroyInstance(instance.instanceId);
  }
}

/**
 * Drives the benchmark harness end to end: rents and measures every targeted rig shape one at a
 * time, recording each result into the committed rig-profiles table as it lands so a crash partway
 * through the sweep does not lose already-measured rigs.
 *
 * A single rig's failure (a marketplace offer disappearing, an SSH collection timeout, a malformed
 * benchmark envelope) is logged and skipped rather than aborting the sweep — the point of running
 * the whole shortlist in one invocation is that one bad rig should not cost the measurements of the
 * others.
 */
export async function main(argv: string[]): Promise<void> {
  const apiKey = process.env.VAST_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("VAST_API_KEY is required (set it in the environment before running the CLI)");
  }

  const { image, gpu } = parseArgs(argv);
  const targets = selectTargets(BENCHMARK_SHORTLIST, gpu);
  const client = createVastClient(apiKey);

  let profilesFile = await loadRigProfiles();

  try {
    for (const want of targets) {
      const label = `${want.gpuName} x${want.gpuCount}`;
      try {
        console.log(`benchmarking ${label}...`);
        const profile = await benchmarkOneRig({
          client,
          collect: collectViaSsh,
          image,
          want,
          now: () => new Date().toISOString(),
          onstart: BENCHMARK_ONSTART_COMMAND,
        });
        profilesFile = {
          generatedAt: new Date().toISOString(),
          profiles: upsertProfile(profilesFile.profiles, profile),
        };
        await saveRigProfiles(profilesFile);
        console.log(`recorded ${label}: ${profile.dollarsPerHour}/hr, ${profile.bootSeconds}s boot`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`skipping ${label} after failure: ${detail}`);
      }
    }
  } finally {
    // Runs even if the sweep above throws, and never lets a reconciliation failure crash the
    // process after profiles are already written — the sweep's own per-rig destroy in `finally`
    // already handles the common case, so a reconciliation error just means the billing backstop
    // did not additionally run this time, not that the measured profiles are at risk.
    try {
      await reconcileLeakedInstances(client);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`reconciliation sweep failed (profiles already written): ${detail}`);
    }
  }
}

const isDirectlyExecuted =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectlyExecuted) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
