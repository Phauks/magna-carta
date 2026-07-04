import { cheapestVerifiedOffer, type RigShape } from "./offer-filter.ts";
import { parseBenchmarkJson } from "./bench-parse.ts";
import type { RigProfile } from "./profiles.ts";
import type { VastClient } from "./vast-client.ts";

/**
 * Reads the raw benchmark JSON off a booted instance. The real implementation opens an SSH
 * connection to the rented instance and captures the benchmark container's stdout; this type
 * exists so `benchmarkOneRig` can be exercised with a fake collector in tests, without an actual
 * SSH round trip.
 */
export type CollectFn = (instance: { sshHost: string; sshPort: number }) => Promise<string>;

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

/** Bounded polling for the rented instance to report `running`: attempts * interval is the boot-timeout ceiling. */
const MAX_POLL_ATTEMPTS = 60;
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pollUntilRunning(
  client: VastClient,
  instanceId: number,
): Promise<{ sshHost: string; sshPort: number }> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const status = await client.getInstance(instanceId);
    if (status.status === "running" && status.sshHost !== null && status.sshPort !== null) {
      return { sshHost: status.sshHost, sshPort: status.sshPort };
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
 * Benchmarks one rig end-to-end: picks the cheapest verified marketplace offer matching `want`,
 * rents it, polls until it boots, collects the benchmark container's JSON output, and returns the
 * resulting `RigProfile`.
 *
 * The rented instance is destroyed in a `finally` block covering every step from the moment it is
 * created — a failure polling for boot, collecting output, or parsing the result still tears the
 * instance down before the error propagates, so a broken run never keeps billing. Nothing is
 * rented (and there is nothing to destroy) when no offer matches `want`.
 */
export async function benchmarkOneRig(deps: BenchmarkOneRigDeps): Promise<RigProfile> {
  const offers = await deps.client.searchOffers({
    gpu_name: deps.want.gpuName,
    num_gpus: deps.want.gpuCount,
    verified: true,
    rentable: true,
  });
  const offer = cheapestVerifiedOffer(offers, deps.want, MINIMUM_HOST_RELIABILITY);
  if (offer === null) {
    throw new NoMatchingOfferError(
      `no verified offer found for ${deps.want.gpuName} x${deps.want.gpuCount} at reliability >= ${MINIMUM_HOST_RELIABILITY}`,
    );
  }

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

    const running = await pollUntilRunning(deps.client, instanceId);
    const bootSeconds = (Date.now() - bootStartedAt) / 1000;

    const raw = await deps.collect(running);
    const result = parseBenchmarkJson(raw);

    return {
      gpuName: result.gpuName,
      gpuCount: result.gpuCount,
      gpuRamMegabytes: result.gpuRamMegabytes,
      dollarsPerHour: offer.dollarsPerHour,
      bootSeconds,
      throughput: result.throughput,
      measuredAt: deps.now(),
    };
  } finally {
    if (instanceId !== undefined) {
      await deps.client.destroyInstance(instanceId);
    }
  }
}
