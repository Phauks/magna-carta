/*
 * Cloudflare's measurement ladder, written out because the library exports no default to borrow
 * from — and with its `packetLoss` step deliberately removed from the base rounds.
 *
 * Packet loss is measured by relaying UDP through a WebRTC TURN server. Cloudflare's public TURN
 * server is discontinued and we run none, so the step can only fail — and a failure there aborts
 * the whole run, taking the bandwidth and latency results with it. Every other phase is theirs,
 * unchanged, which is what keeps these numbers comparable to speed.cloudflare.com.
 *
 * `buildLadder` replaces four exported constants (full, full+loss, light, light+loss) with one
 * builder over two booleans: `lowData` drops rounds above the cap, `packetLoss` splices the phase
 * back in at Cloudflare's own position (after the first upload round). Low-data mode DROPS the
 * large rounds rather than inventing new ones, so a light run is always a strict prefix of the
 * real one — same rounds, same order, fewer of them.
 */
import type { MeasurementConfig } from "@cloudflare/speedtest";

/** Above this payload size a round is dropped in low-data mode. */
export const LOW_DATA_MAX_BYTES = 1e6;

/*
 * The figure the page prints for a low-data run. The payloads sum to about 15.8 MB; this ceiling
 * covers protocol overhead, which the payload sum excludes, and lands on a round tenth of the full
 * run. A test pins the ladder beneath it, so the sentence on the page cannot quietly go false.
 */
export const LOW_DATA_DISCLOSED_CEILING_BYTES = 2e7;

// Cloudflare's own rounds, in their order, packet loss aside — the single source both modes filter.
const BASE_ROUNDS: MeasurementConfig[] = [
  { type: "latency", numPackets: 1 },
  { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: "latency", numPackets: 20 },
  { type: "download", bytes: 1e5, count: 9 },
  { type: "download", bytes: 1e6, count: 8 },
  { type: "upload", bytes: 1e5, count: 8 },
  { type: "upload", bytes: 1e6, count: 6 },
  { type: "download", bytes: 1e7, count: 6 },
  { type: "upload", bytes: 1e7, count: 4 },
  { type: "download", bytes: 2.5e7, count: 4 },
  { type: "upload", bytes: 2.5e7, count: 4 },
  { type: "download", bytes: 1e8, count: 3 },
  { type: "upload", bytes: 5e7, count: 3 },
  { type: "download", bytes: 2.5e8, count: 2 },
];

// The library's documented defaults for the relay phase, restored at Cloudflare's own position:
// after the first upload round. Used only when credentials for the relay were actually obtained —
// see turn-capability.ts.
const PACKET_LOSS_PHASE: MeasurementConfig = {
  type: "packetLoss",
  numPackets: 1e3,
  batchSize: 10,
  batchWaitTime: 10,
  responsesWaitTime: 3000,
};

export function buildLadder(options: {
  lowData: boolean;
  packetLoss: boolean;
}): MeasurementConfig[] {
  const rounds = options.lowData
    ? BASE_ROUNDS.filter((round) => !("bytes" in round) || round.bytes <= LOW_DATA_MAX_BYTES)
    : BASE_ROUNDS;

  if (!options.packetLoss) return rounds;

  const insertAt = rounds.findIndex((round) => round.type === "upload") + 1;
  return [...rounds.slice(0, insertAt), PACKET_LOSS_PHASE, ...rounds.slice(insertAt)];
}
