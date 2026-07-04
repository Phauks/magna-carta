import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { BENCHMARK_SHORTLIST, type RigShape } from "./offer-filter.ts";
import type { RigProfile } from "./profiles.ts";
import { upsertProfile } from "./profiles.ts";
import { benchmarkOneRig } from "./run.ts";
import { collectViaLogs } from "./logs-collect.ts";
import { createVastClient, type VastClient } from "./vast-client.ts";

/**
 * A public Docker Hub image with hashcat and CUDA preinstalled, built for vast.ai rentals — no
 * custom image, build, or registry needed. `--image <ref>` overrides this for a one-off run
 * against a different image.
 */
// Explicit CUDA tag rather than `:latest` — a specific tag avoids `:latest` ambiguity, and a host
// that cannot pull it (e.g. Docker Hub anonymous rate-limits, which surface as a "failed to resolve
// reference" / "not found" daemon error) is failed and retried on the next offer by the run driver.
export const DEFAULT_BENCHMARK_IMAGE = "dizcza/docker-hashcat:cuda";

/**
 * The command each rented instance runs on boot: prints the rig's GPU facts, then runs `hashcat
 * -b` for every hash mode the recovery ladder cares about, echoing a begin/end marker the
 * collector (`logs-collect.ts`) watches for in the instance's captured stdout. Renting with
 * `runtype: "ssh"` (see `vast-client.ts`'s `createInstance`) already keeps the instance's sshd
 * process — and therefore the instance itself — alive once this command exits, so unlike the
 * retired custom-image approach there is no need for a trailing `sleep infinity`.
 */
export const BENCHMARK_ONSTART_COMMAND =
  "echo BENCH_BEGIN; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1; for m in 9600 10700 11600 10500 13600 17200 9400 9500; do echo MODE=$m; hashcat -b -m $m --machine-readable --quiet 2>&1; done; echo BENCH_END";

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
  // `--reconcile` runs only the leaked-instance sweep and exits without renting anything — the
  // manual pull of the dead-man's switch, for cleaning up after a crashed or killed run (whose
  // `finally` sweep never got to run) without paying for a fresh benchmark.
  readonly reconcileOnly: boolean;
}

/** Thrown for a malformed or incomplete command line — never a benchmark or vast.ai failure. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * Parses `--image <ref>` (optional, defaults to the public hashcat image) and `--gpu <name>`
 * (optional). Anything else on the command line is ignored rather than rejected, so this stays a
 * thin driver rather than a general-purpose argument parser.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let image: string | undefined;
  let gpu: string | undefined;
  let reconcileOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--image") {
      image = argv[index + 1];
      index++;
    } else if (token === "--gpu") {
      gpu = argv[index + 1];
      index++;
    } else if (token === "--reconcile") {
      reconcileOnly = true;
    }
  }
  return {
    image: image === undefined || image === "" ? DEFAULT_BENCHMARK_IMAGE : image,
    gpu,
    reconcileOnly,
  };
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

  const { image, gpu, reconcileOnly } = parseArgs(argv);
  const client = createVastClient(apiKey);

  // Dead-man's switch, client side: a run that crashed or was killed never reached its `finally`
  // teardown, so its rented rig can still be billing. `--reconcile` is the manual pull — sweep any
  // leaked benchmark rig and exit, renting nothing. Selecting targets happens after this so the
  // sweep runs even for an otherwise-invalid `--gpu`.
  if (reconcileOnly) {
    await reconcileLeakedInstances(client);
    return;
  }

  const targets = selectTargets(BENCHMARK_SHORTLIST, gpu);

  // Same switch, fired automatically at the top of every run: clear any orphan a previous crashed
  // run left behind before renting more. Combined with the `finally` sweep below, this bounds a
  // killed run's leak to "until the next run (or manual --reconcile)" instead of "until noticed".
  await reconcileLeakedInstances(client);

  let profilesFile = await loadRigProfiles();

  try {
    for (const want of targets) {
      const label = `${want.gpuName} x${want.gpuCount}`;
      try {
        console.log(`benchmarking ${label}...`);
        const profile = await benchmarkOneRig({
          client,
          collect: collectViaLogs,
          image,
          want,
          now: () => new Date().toISOString(),
          onstart: BENCHMARK_ONSTART_COMMAND,
          // The benchmark measures hardware and has no firm context, so it defaults to US. The
          // production rung derives this from the firm's data_region setting (us -> ["US"],
          // eu -> the EU country set) so the rig follows the firm's jurisdiction.
          geolocationCountries: ["US"],
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
