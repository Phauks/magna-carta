/*
 * The run, written down — a plain-text record a lawyer can paste into the body of an email to an
 * ISP or an office manager and have read without a viewer. Assembled in the browser from the run in
 * front of you; nothing here persists, sends, or attaches. The page owns the download itself (Blob
 * to object URL to click), so this module stays a pure string function testable in the node pool.
 *
 * It must never invent a measurement. An absent value reads as the spoken absence form ("not
 * measured"), never as a zero (a real reading) and never as the on-screen hyphen — a bare dash means
 * nothing in a text file a reader opens outside the app. The formatting itself is reused from
 * speed-test-format.ts and run-progress.ts; this file only arranges it.
 */
import { ABSENT_DESCRIPTION } from "./absence.ts";
import { useCaseLabel } from "./quality-labels.ts";
import { formatBytes } from "./run-progress.ts";
import { formatBandwidth, formatMilliseconds, formatRatio } from "./speed-test-format.ts";

export interface ReportInput {
  finishedAt: Date;
  downloadBps: number | undefined;
  uploadBps: number | undefined;
  latencyMs: number | undefined;
  jitterMs: number | undefined;
  packetLoss: { measured: true; ratio: number } | { measured: false; reason: string };
  scores: Record<"streaming" | "gaming" | "rtc", string> | undefined;
  server: {
    clientIp: string;
    asOrganization: string;
    asn: number;
    coloCity: string;
    coloIata: string;
  } | null;
  roundTrip: { reachable: true; medianMs: number } | { reachable: false; note: string };
  bytesDown: number;
  bytesUp: number;
}

// The use-cases the AIM panel rates, in the order the page shows them. useCaseLabel names each.
const USE_CASES = ["streaming", "gaming", "rtc"] as const;

/** A measured bandwidth, or the spoken absence form for a value that was not measured. */
function bandwidth(value: number | undefined): string {
  return value === undefined ? ABSENT_DESCRIPTION : formatBandwidth(value);
}

/** A measured duration, or the spoken absence form for a value that was not measured. */
function milliseconds(value: number | undefined): string {
  return value === undefined ? ABSENT_DESCRIPTION : formatMilliseconds(value);
}

/**
 * `network-speed-test-YYYY-MM-DDTHH-MM-SS.txt`, in UTC, so a folder of reports sorts chronologically
 * and the colons an ISO time carries (illegal in a filename on Windows) become hyphens.
 */
export function reportFilename(finishedAt: Date): string {
  const stamp = finishedAt.toISOString().slice(0, 19).replace(/:/g, "-");
  return `network-speed-test-${stamp}.txt`;
}

/** The UTC instant the run finished, e.g. `2026-07-09 20:40:21 UTC`. */
function runAt(finishedAt: Date): string {
  return `${finishedAt.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];

  lines.push("Network Speed Test - Magna Carta");
  lines.push(`Run at ${runAt(input.finishedAt)}`);
  lines.push("");

  lines.push(`Download: ${bandwidth(input.downloadBps)}`);
  lines.push(`Upload: ${bandwidth(input.uploadBps)}`);
  lines.push(`Latency: ${milliseconds(input.latencyMs)}`);
  lines.push(`Jitter: ${milliseconds(input.jitterMs)}`);
  lines.push(
    input.packetLoss.measured
      ? `Packet loss: ${formatRatio(input.packetLoss.ratio)}`
      : `Packet loss: ${ABSENT_DESCRIPTION}. ${input.packetLoss.reason}`,
  );
  lines.push("");

  lines.push("Network quality (Cloudflare AIM)");
  for (const key of USE_CASES) {
    const rating = input.scores ? input.scores[key] : ABSENT_DESCRIPTION;
    lines.push(`  ${useCaseLabel(key)}: ${rating}`);
  }
  if (!input.packetLoss.measured) {
    lines.push(
      "  These ratings are incomplete: packet loss feeds all three and was not measured.",
    );
  }
  lines.push("");

  lines.push("Measurement server");
  if (input.server === null) {
    lines.push("  The measurement server did not identify itself.");
  } else {
    lines.push(`  Served from: ${input.server.coloCity} (${input.server.coloIata})`);
    lines.push(`  Your network: ${input.server.asOrganization} (AS${input.server.asn})`);
    lines.push(`  Your address: ${input.server.clientIp}`);
  }
  lines.push(
    input.roundTrip.reachable
      ? `  Round trip to Magna Carta: ${formatMilliseconds(input.roundTrip.medianMs)}`
      : `  Round trip to Magna Carta: ${ABSENT_DESCRIPTION}. ${input.roundTrip.note}`,
  );
  lines.push("");

  lines.push("Data used by this test");
  lines.push(`  Downloaded: ${formatBytes(input.bytesDown)}`);
  lines.push(`  Uploaded: ${formatBytes(input.bytesUp)}`);
  lines.push(`  Total: ${formatBytes(input.bytesDown + input.bytesUp)}`);
  lines.push("");

  lines.push(
    "Bandwidth figures are this run's 90th percentile and latency its median, not averages.",
  );
  lines.push("Measured with Cloudflare's speed-test engine. Nothing was saved.");

  return `${lines.join("\n")}\n`;
}
