/*
 * Describing a run in flight.
 *
 * There is no countdown here, deliberately. The engine abandons the rest of a bandwidth type once
 * one of its requests grows slow, so the data a run will transfer — and therefore how long it will
 * take — depends on the connection being measured. A remaining-time or remaining-megabytes figure
 * would be invented. What IS knowable: which phase is running, how far through the ladder it is,
 * and how much data has already crossed the wire.
 */
import type { MeasurementConfig } from "@cloudflare/speedtest";

export function phaseLabel(measurement: MeasurementConfig): string {
  switch (measurement.type) {
    case "latency":
      return "Measuring latency";
    case "download":
      return "Measuring download speed";
    case "upload":
      return "Measuring upload speed";
    case "packetLoss":
      return "Measuring packet loss";
  }
}

/** Whole units only: a byte count measured across a network is not precise to three decimals. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} kB`;
}

/*
 * What a run actually spent, one direction at a time.
 *
 * `bytes` is the payload, not the wire cost. BandwidthPoint also carries `transferSize` from
 * PerformanceResourceTiming, which is the true bytes-on-the-wire — but only for the RESPONSE, so it
 * measures a download honestly and an upload not at all. Rather than mix two meanings and undercount
 * uploads, both directions are counted in payload bytes. Protocol overhead is excluded; on a
 * hundred-megabyte transfer it is noise.
 */
export function bytesInDirection(points: ReadonlyArray<{ bytes: number }>): number {
  return points.reduce((carry, point) => carry + point.bytes, 0);
}

export function bytesTransferred(
  download: ReadonlyArray<{ bytes: number }>,
  upload: ReadonlyArray<{ bytes: number }>,
): number {
  return bytesInDirection(download) + bytesInDirection(upload);
}
