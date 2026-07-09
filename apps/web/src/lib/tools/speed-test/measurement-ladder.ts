/*
 * Cloudflare's measurement ladder, written out because the library exports no default to borrow
 * from — and with its `packetLoss` step deliberately removed.
 *
 * Packet loss is measured by relaying UDP through a WebRTC TURN server. Cloudflare's public TURN
 * server is discontinued and we run none, so the step can only fail — and a failure there aborts
 * the whole run, taking the bandwidth and latency results with it. Every other phase is theirs,
 * unchanged, which is what keeps these numbers comparable to speed.cloudflare.com.
 */
import type { MeasurementConfig } from "@cloudflare/speedtest";

export const MEASUREMENT_LADDER: MeasurementConfig[] = [
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
