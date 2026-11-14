/*
 * The connection's last few minutes as plain text a member can copy and paste to whoever is helping
 * them: what each picture coming in did (frames received, decoded, dropped, frozen, asked for again),
 * what this browser's own camera is doing and what is holding it back, and the wire events.
 *
 * WHY A WINDOW AND NOT A MOMENT. A stutter has usually passed by the time somebody opens the panel,
 * so a reading of "now" says everything is fine. The counters are cumulative, so the first and last
 * of the samples the diagnostics keep (five minutes of them) give what happened over that window,
 * and the stutter is in there.
 *
 * WHAT IT CARRIES IS NUMBERS, on the rule in this directory's CLAUDE.md: participants by the room's
 * handle, never a name; no track name, no session description, nothing anybody typed. Pure, so the
 * arithmetic is a unit test.
 */
import type { ConnectionSample, InboundSample } from "./connection-quality.ts";
import type { DiagnosticEvent } from "./diagnostics.svelte.ts";

/** What the report says about the browser and the member's own settings, which the stats cannot. */
export interface DiagnosticEnvironment {
  readonly userAgent: string;
  readonly processors: number | null;
  /** The background treatment on this member's camera: none, blur or image. */
  readonly background: string;
  readonly layout: string;
  readonly copiedAt: Date;
}

/** A counter's growth over the window, or null where either end did not report it. */
function grew(first: number | null | undefined, last: number | null | undefined): number | null {
  if (first === null || first === undefined || last === null || last === undefined) return null;
  return last >= first ? last - first : null;
}

function shown(value: number | null | undefined, unit = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "not reported";
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded)}${unit}`;
}

/** A count of times, read as a sentence: "3 times", "once", or "not reported" with no "times" after it. */
function times(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "not reported";
  if (value === 1) return "once";
  return `${shown(value)} times`;
}

/** The camera layer in words: what the panel's Camera Size row says, not the wire's letter. */
const LAYER_WORDS: Readonly<Record<string, string>> = { f: "full", h: "half", q: "quarter" };

function layerWords(rid: string | null | undefined): string {
  if (rid === null || rid === undefined) return "one size only";
  return `${LAYER_WORDS[rid] ?? rid} size`;
}

function percent(value: number | null): string {
  return value === null ? "not reported" : `${(value * 100).toFixed(1)}%`;
}

function size(width: number | null | undefined, height: number | null | undefined): string {
  return width === null || width === undefined || height === null || height === undefined
    ? "not reported"
    : `${String(width)}x${String(height)}`;
}

function kilobits(bitsPerSecond: number | null | undefined): string {
  return bitsPerSecond === null || bitsPerSecond === undefined
    ? "not reported"
    : shown(bitsPerSecond / 1000, " kbit/s");
}

/** One incoming video stream over the window. */
function inboundLines(first: InboundSample | null, last: InboundSample, seconds: number): string[] {
  const received = grew(first?.framesReceived, last.framesReceived);
  const decoded = grew(first?.framesDecoded, last.framesDecoded);
  const dropped = grew(first?.framesDropped, last.framesDropped);
  const freezes = grew(first?.freezeCount, last.freezeCount);
  const frozen = grew(first?.totalFreezesDuration, last.totalFreezesDuration);
  const lost = grew(first?.packetsLost, last.packetsLost);
  const delivered = grew(first?.packetsReceived, last.packetsReceived);
  const bufferDelay = grew(first?.jitterBufferDelay, last.jitterBufferDelay);
  const emitted = grew(first?.jitterBufferEmittedCount, last.jitterBufferEmittedCount);
  const lossShare =
    lost === null || delivered === null || lost + delivered === 0
      ? null
      : lost / (lost + delivered);
  return [
    `- ${last.participantId ?? "unknown participant"} (section ${last.mid ?? "?"})`,
    `  picture ${size(last.frameWidth, last.frameHeight)} at ${shown(last.framesPerSecond, " fps")}`,
    `  over ${shown(seconds, " s")}: frames received ${shown(received)}, decoded ${shown(decoded)}, dropped ${shown(dropped)}`,
    `  freezes ${shown(freezes)} totalling ${shown(frozen, " s")}`,
    `  packets lost ${percent(lossShare)}, jitter ${shown(last.jitterMilliseconds, " ms")}, buffer wait ${
      bufferDelay === null || emitted === null || emitted === 0
        ? "not reported"
        : shown((bufferDelay / emitted) * 1000, " ms")
    }`,
    `  asked for a new picture ${times(grew(first?.pliCount, last.pliCount))}, for lost packets ${times(grew(first?.nackCount, last.nackCount))}`,
  ];
}

/**
 * The text a member copies. `samples` is the diagnostics' window, oldest first; `events` the wire
 * events it holds.
 */
export function diagnosticText(
  samples: readonly ConnectionSample[],
  events: readonly DiagnosticEvent[],
  environment: DiagnosticEnvironment,
): string {
  const first = samples[0] ?? null;
  const last = samples.at(-1) ?? null;
  const lines: string[] = [
    "Meeting connection diagnostics",
    `copied ${environment.copiedAt.toISOString()}`,
    `browser ${environment.userAgent}`,
    `processors ${shown(environment.processors)}`,
    `background ${environment.background}, layout ${environment.layout}`,
  ];
  if (first === null || last === null) {
    lines.push("", "No measurements yet: the connection has not been sampled.");
    return lines.join("\n");
  }
  const seconds = Math.max(0, (last.at - first.at) / 1000);
  lines.push(
    `window ${shown(seconds, " s")} over ${String(samples.length)} samples`,
    `round trip ${shown(last.roundTripMilliseconds, " ms")}`,
    `upload ${kilobits(last.uploadBitsPerSecond)}, download ${kilobits(last.downloadBitsPerSecond)}`,
    // How the media reaches the server, never the address: this text is pasted to other people.
    `server ${
      last.server === null || last.server === undefined
        ? "not reported"
        : `${last.server.relayed ? "through a relay" : "direct"}, ${last.server.protocol ?? "transport not reported"}`
    }`,
    "",
    "Sending (this camera)",
  );
  const uplink = last.uplink;
  if (uplink === null) {
    lines.push("- nothing is being sent");
  } else {
    const firstUplink =
      first.uplink !== null && first.uplink.id === uplink.id ? first.uplink : null;
    lines.push(
      `- ${layerWords(uplink.rid)}, picture ${size(uplink.frameWidth, uplink.frameHeight)} at ${shown(uplink.framesPerSecond, " fps")}`,
      `  going out ${uplink.bitsPerSecond === null ? "not reported" : shown(uplink.bitsPerSecond / 1000, " kbit/s")}, far end lost ${percent(uplink.lossFraction)}`,
      `  held back by ${uplink.qualityLimitationReason ?? "not reported"}`,
      `  asked for a new picture ${times(grew(firstUplink?.pliCount, uplink.pliCount))}`,
    );
  }

  lines.push("", "Receiving (video)");
  const pictures = last.inbound.filter((entry) => entry.kind === "video");
  if (pictures.length === 0) lines.push("- no pictures coming in");
  for (const picture of pictures) {
    const earlier = first.inbound.find((entry) => entry.id === picture.id) ?? null;
    lines.push(...inboundLines(earlier, picture, seconds));
  }

  lines.push("", "Wire events (oldest first)");
  if (events.length === 0) lines.push("- none");
  for (const event of events) {
    const detail = event.detail === null ? "" : ` (${event.detail})`;
    const errorId = event.errorId === null ? "" : ` ${event.errorId}`;
    lines.push(`- ${new Date(event.at).toISOString()} ${event.kind}${detail}${errorId}`);
  }
  return lines.join("\n");
}
