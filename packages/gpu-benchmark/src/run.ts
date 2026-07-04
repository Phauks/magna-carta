import { rankedVerifiedOffers, type RigShape } from "./offer-filter.ts";
import { parseBenchmarkLog } from "./bench-parse.ts";
import type { RigProfile } from "./profiles.ts";
import type { VastClient } from "./vast-client.ts";

/**
 * Reads the raw benchmark output off a booted instance. The real implementation
 * (`logs-collect.ts`) polls vast.ai's logs API for the rented instance's stdout; this type
 * exists so `benchmarkOneRig` can be exercised with a fake collector in tests, without a real
 * vast.ai round trip.
 */
export type CollectFn = (client: VastClient, instanceId: number) => Promise<string>;

export interface BenchmarkOneRigDeps {
  readonly client: VastClient;
  readonly collect: CollectFn;
  readonly image: string;
  readonly want: RigShape;
  readonly now: () => string;
  readonly onstart: string;
}

/**
 * Marketplace hosts below this reliability are excluded regardless of price: an unreliable host
 * risks dying mid-benchmark, wasting the rental and forcing a second paid run to get a measurement.
 */
const MINIMUM_HOST_RELIABILITY = 0.95;

/**
 * How many ranked (cheapest-first) offers `benchmarkOneRig` will try before giving up. Observed
 * live: a rented rig can fail to boot or run at all (an RTX 4090 x4 host once returned an OCI
 * "unable to start container process" error) — bounded retries onto the next-cheapest offer let
 * one bad host cost a few extra cents rather than the whole rig's measurement.
 */
const MAX_OFFER_ATTEMPTS = 3;

/** Bounded polling for the rented instance to report `running`: attempts * interval is the boot-timeout ceiling. */
const MAX_POLL_ATTEMPTS = 90;
const POLL_INTERVAL_MILLISECONDS = 5000;

/** Thrown when no marketplace offer matches the wanted rig shape at the reliability floor. Nothing is rented. */
export class NoMatchingOfferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoMatchingOfferError";
  }
}

/** Thrown when a rented instance never reports `running` within the bounded poll window. */
export class InstanceBootTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceBootTimeoutError";
  }
}

/** Thrown when a rented instance reports a terminal failure (e.g. a container runtime error) before ever reaching `running`. */
export class InstanceFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceFailedError";
  }
}

/** Thrown when every offer `benchmarkOneRig` tried (up to `MAX_OFFER_ATTEMPTS`) failed. */
export class AllOffersFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllOffersFailedError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Only a status message that names a concrete runtime error is a real boot failure. The normal
// boot path reports benign progress messages like "Pulling from <image>", "Downloading",
// "Extracting", and "Successfully loaded <image>" while a multi-gigabyte GPU image is fetched —
// those are NOT failures and must not abort the rig (a real container failure reads e.g. "Error
// response from daemon: failed to create task ... OCI runtime create failed ... unable to start").
const BOOT_ERROR_PATTERN = /error|oci runtime|failed to create|unable to start|cannot start|no space/i;

async function pollUntilRunning(client: VastClient, instanceId: number): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const status = await client.getInstance(instanceId);
    // The result is collected over vast.ai's logs API, not SSH, so reaching `running` is the only
    // success condition — the ssh host/port are irrelevant here.
    if (status.status === "running") {
      return;
    }
    if (status.statusMsg !== null && BOOT_ERROR_PATTERN.test(status.statusMsg)) {
      throw new InstanceFailedError(
        `instance ${instanceId} failed to boot: ${status.status} — ${status.statusMsg}`,
      );
    }
    if (attempt < MAX_POLL_ATTEMPTS - 1) {
      await sleep(POLL_INTERVAL_MILLISECONDS);
    }
  }
  throw new InstanceBootTimeoutError(
    `instance ${instanceId} did not reach running status within ${MAX_POLL_ATTEMPTS} poll attempts`,
  );
}

/**
 * Benchmarks one rig end-to-end: ranks verified marketplace offers matching `want` cheapest
 * first, then rents, boots, and benchmarks them in that order until one succeeds. A bad rig —
 * a boot failure, a log-collection timeout, a malformed benchmark result — destroys that
 * instance and falls through to the next-cheapest offer, bounded by `MAX_OFFER_ATTEMPTS`.
 *
 * Every instance this rents is destroyed in a `finally` covering every step from the moment it
 * is created, so a broken attempt never keeps billing — this holds for both a failed attempt
 * (destroyed before the retry moves on) and the winning attempt (destroyed after its result is
 * captured). Nothing is rented (and there is nothing to destroy) when no offer matches `want`.
 */
export async function benchmarkOneRig(deps: BenchmarkOneRigDeps): Promise<RigProfile> {
  const offers = await deps.client.searchOffers({
    gpu_name: { in: [deps.want.gpuName] },
    num_gpus: { eq: deps.want.gpuCount },
    rentable: { eq: true },
    // The query filter field is `verified` (bool); the response field vast.ai returns per
    // offer is `verification` (a string) — see vast-client.ts's wire-schema mapping.
    verified: { eq: true },
    limit: 64,
    order: [["dph_total", "asc"]],
  });
  const ranked = rankedVerifiedOffers(offers, deps.want, MINIMUM_HOST_RELIABILITY);
  if (ranked.length === 0) {
    throw new NoMatchingOfferError(
      `no verified offer found for ${deps.want.gpuName} x${deps.want.gpuCount} at reliability >= ${MINIMUM_HOST_RELIABILITY}`,
    );
  }

  const candidates = ranked.slice(0, MAX_OFFER_ATTEMPTS);
  let lastError: unknown;

  for (const offer of candidates) {
    let instanceId: number | undefined;
    const bootStartedAt = Date.now();
    try {
      const instance = await deps.client.createInstance(offer.offerId, {
        image: deps.image,
        label: `gpu-benchmark-${deps.want.gpuName}-${deps.want.gpuCount}`,
        onstart: deps.onstart,
        diskGb: 20,
      });
      instanceId = instance.instanceId;

      await pollUntilRunning(deps.client, instanceId);
      const bootSeconds = (Date.now() - bootStartedAt) / 1000;

      const raw = await deps.collect(deps.client, instanceId);
      const result = parseBenchmarkLog(raw);

      return {
        gpuName: result.gpuName,
        gpuCount: result.gpuCount,
        gpuRamMegabytes: result.gpuRamMegabytes,
        dollarsPerHour: offer.dollarsPerHour,
        bootSeconds,
        throughput: result.throughput,
        measuredAt: deps.now(),
      };
    } catch (error) {
      lastError = error;
      continue;
    } finally {
      if (instanceId !== undefined) {
        await deps.client.destroyInstance(instanceId);
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new AllOffersFailedError(
    `every offer tried for ${deps.want.gpuName} x${deps.want.gpuCount} failed (${candidates.length} attempt(s)): ${detail}`,
  );
}
