/*
 * What the connection is actually doing, read off the peer connection's own statistics.
 *
 * NOTHING HERE TOUCHES A BROWSER. It takes a statistics report as an iterable of plain records, the
 * previous reading, and the instant — and answers with a sample. That is what lets the thresholds
 * below be argued with in a unit test over hand-built numbers instead of being judged by watching a
 * meeting go wrong.
 *
 * WHY A SAMPLE NEEDS THE ONE BEFORE IT. Almost every number a connection reports is a COUNTER that
 * only ever climbs: packets lost, packets received, bytes sent. A counter says what has happened
 * since the connection opened, which after twenty minutes is a number nobody can read anything out
 * of — a meeting that was poor for its first minute and perfect since reports the same loss figure
 * as one that is failing right now. What a member can act on is what changed over the last few
 * seconds, so every rate here is a DIFFERENCE between two readings and is null on the first one.
 *
 * ROUND TRIP COMES FROM THE CANDIDATE PAIR, not from a stream. It is a fact about the path between
 * this browser and the unit, and it is the same path whoever's picture is travelling over it, so
 * reading it per stream would be reading one number several times and disagreeing with itself.
 */

/** One entry of a statistics report, as the browser hands it over. */
export type StatsEntry = Record<string, unknown>;

/**
 * A statistics report, or anything shaped like one.
 *
 * A browser's own `RTCStatsReport` iterates as `[id, entry]` pairs; a test hands over a plain array
 * of entries. Both are read, because insisting on the browser's shape is what would put a real
 * `RTCStatsReport` in the way of every case about the thresholds.
 */
export type StatsReportLike = Iterable<StatsEntry | readonly [string, StatsEntry]>;

/** How good a connection is, in the four words a member is ever shown. */
export type ConnectionQuality = "good" | "fair" | "poor" | "unknown";

/**
 * The three facts the judgment is made from. Each one is null where nothing has measured it yet,
 * and all three null is what `unknown` means.
 */
export interface QualityFacts {
  /** The path's round trip, in milliseconds. */
  readonly roundTripMilliseconds: number | null;
  /** The share of packets lost OVER THE INTERVAL, between 0 and 1. Never the lifetime figure. */
  readonly lossFraction: number | null;
  /** The arrival jitter, in milliseconds. */
  readonly jitterMilliseconds: number | null;
}

/** One incoming stream, as this sample found it. */
export interface InboundSample extends QualityFacts {
  /** The report's own handle for the stream, which is what the next sample is matched against. */
  readonly id: string;
  /** The media section it arrives on. Null where the report did not name one. */
  readonly mid: string | null;
  /** Whose it is, where the media sections could be traced back to a participant. */
  readonly participantId: string | null;
  readonly kind: "audio" | "video";
  readonly packetsLost: number;
  readonly packetsReceived: number;
  readonly bytesReceived: number;
  readonly framesReceived: number;
  readonly framesDropped: number;
}

/** What this browser is sending from its camera, as this sample found it. */
export interface UplinkSample extends QualityFacts {
  readonly id: string;
  readonly mid: string | null;
  /**
   * The simulcast layer this entry is, where the publication carries layers. The camera is offered
   * as three (`f`, `h`, `q`) and a screen share as one, which is also how the two are told apart
   * when nothing else names them.
   */
  readonly rid: string | null;
  readonly frameWidth: number | null;
  readonly frameHeight: number | null;
  readonly bytesSent: number;
  readonly packetsSent: number;
  /**
   * What the FAR END says it has lost of this stream, which is the only place an outbound loss can
   * be known: what happens to a packet after it leaves is not something this browser can measure.
   * Null where the unit has not reported back yet.
   */
  readonly packetsLost: number | null;
  readonly framesSent: number;
  /** What is going out over the interval, in bits per second. Null on the first sample. */
  readonly bitsPerSecond: number | null;
}

/** One reading of the connection. */
export interface ConnectionSample {
  /** When it was taken, on this browser's clock. */
  readonly at: number;
  /** The path's round trip, from the candidate pair in use. */
  readonly roundTripMilliseconds: number | null;
  /** This browser's own camera, as it is being sent. Null before anything is published. */
  readonly uplink: UplinkSample | null;
  readonly inbound: readonly InboundSample[];
}

/** What a sample needs to know that the report itself cannot say. */
export interface SampleContext {
  /**
   * Who the track on a media section belongs to. The subscriptions module is what keeps that
   * mapping, because it is the thing that asked for the track in the first place.
   */
  readonly ownerOfMid?: (mid: string) => string | null;
  /**
   * The media section this browser's screen share is going out on, where one is. The share is a
   * second outbound video publication and it is not the camera, so it is named rather than guessed
   * at: a member who has turned their camera off and is sharing a screen would otherwise have the
   * share reported as their camera's resolution.
   */
  readonly screenMid?: string | null;
}

/*
 * THE THRESHOLDS, AND WHY THESE NUMBERS.
 *
 * Round trip: conversation turn-taking falls apart somewhere past a fifth of a second each way, and
 * the figure here is the whole round trip, so 200 ms is the edge of comfortable and 400 ms is where
 * people start talking over each other. Loss: a codec conceals a packet or two invisibly, which is
 * why the good band is not zero; past about one in fifty a voice starts sounding clipped, and past
 * about one in twelve a picture breaks up rather than softens. Jitter: the receiver's buffer absorbs
 * a few tens of milliseconds of unevenness at the cost of that much delay, so 30 ms is free and
 * 60 ms is the point where the buffer is either dropping or adding audible lag.
 *
 * They are deliberately generous. A mark that says "poor" while a meeting sounds fine teaches a
 * member to stop reading it, and then it says nothing on the day it is right.
 */
const GOOD_ROUND_TRIP_MILLISECONDS = 200;
const FAIR_ROUND_TRIP_MILLISECONDS = 400;
const GOOD_LOSS_FRACTION = 0.02;
const FAIR_LOSS_FRACTION = 0.08;
const GOOD_JITTER_MILLISECONDS = 30;
const FAIR_JITTER_MILLISECONDS = 60;

/**
 * How good the connection is, from the three facts.
 *
 * THE WORST DIMENSION DECIDES. A path with a fine round trip that is dropping one packet in ten is
 * a broken connection, and averaging the three would report it as fair — so each is judged on its
 * own and the lowest answer is the answer. A fact nobody measured is not counted against anything;
 * where none of the three was measured at all the answer is `unknown`, which is a different
 * statement from `good` and must never be dressed as one.
 */
export function qualityOf(facts: QualityFacts): ConnectionQuality {
  const judgments: ConnectionQuality[] = [];
  if (facts.roundTripMilliseconds !== null) {
    judgments.push(
      band(facts.roundTripMilliseconds, GOOD_ROUND_TRIP_MILLISECONDS, FAIR_ROUND_TRIP_MILLISECONDS),
    );
  }
  if (facts.lossFraction !== null) {
    judgments.push(band(facts.lossFraction, GOOD_LOSS_FRACTION, FAIR_LOSS_FRACTION));
  }
  if (facts.jitterMilliseconds !== null) {
    judgments.push(
      band(facts.jitterMilliseconds, GOOD_JITTER_MILLISECONDS, FAIR_JITTER_MILLISECONDS),
    );
  }
  if (judgments.length === 0) return "unknown";
  if (judgments.includes("poor")) return "poor";
  if (judgments.includes("fair")) return "fair";
  return "good";
}

/** One measurement against its two edges. At or under an edge is inside that band. */
function band(measured: number, good: number, fair: number): ConnectionQuality {
  if (measured <= good) return "good";
  if (measured <= fair) return "fair";
  return "poor";
}

/**
 * How this browser's own sending is doing: the path's round trip, and what the far end says it is
 * receiving of what was sent.
 */
export function uplinkFacts(sample: ConnectionSample): QualityFacts {
  return {
    roundTripMilliseconds: sample.roundTripMilliseconds,
    lossFraction: sample.uplink?.lossFraction ?? null,
    jitterMilliseconds: sample.uplink?.jitterMilliseconds ?? null,
  };
}

/**
 * How one other person's media is arriving: the worst of their streams on each dimension, because a
 * member whose voice is breaking up does not care that their picture is fine.
 */
export function inboundFacts(sample: ConnectionSample, participantId: string): QualityFacts {
  const theirs = sample.inbound.filter((entry) => entry.participantId === participantId);
  if (theirs.length === 0) {
    return {
      roundTripMilliseconds: null,
      lossFraction: null,
      jitterMilliseconds: null,
    };
  }
  return {
    // The path is the same path for everybody, so it is the sample's own figure rather than a
    // per-stream one: a round trip measured per participant would be one number reported many times.
    roundTripMilliseconds: sample.roundTripMilliseconds,
    lossFraction: worst(theirs.map((entry) => entry.lossFraction)),
    jitterMilliseconds: worst(theirs.map((entry) => entry.jitterMilliseconds)),
  };
}

/** The largest of however many measurements, ignoring the ones nothing measured. */
function worst(measured: readonly (number | null)[]): number | null {
  const known = measured.filter((entry): entry is number => entry !== null);
  return known.length === 0 ? null : Math.max(...known);
}

/**
 * Read one statistics report into a sample, against the reading before it.
 *
 * The previous sample is what turns the report's climbing counters into rates; passing null is the
 * first reading of a meeting, where every rate is honestly null rather than zero.
 */
export function summarizeStats(
  report: StatsReportLike,
  previous: ConnectionSample | null,
  now: number,
  context: SampleContext = {},
): ConnectionSample {
  const entries = readEntries(report);
  const elapsedSeconds = previous === null ? null : Math.max(0, (now - previous.at) / 1000);

  return {
    at: now,
    roundTripMilliseconds: readRoundTrip(entries),
    uplink: readUplink(entries, previous, elapsedSeconds, context),
    inbound: readInbound(entries, previous, context),
  };
}

/** Every entry of the report, whichever of the two shapes it arrived in. */
function readEntries(report: StatsReportLike): StatsEntry[] {
  const entries: StatsEntry[] = [];
  for (const held of report) {
    const entry = Array.isArray(held) ? held[1] : held;
    if (typeof entry === "object" && entry !== null) entries.push(entry as StatsEntry);
  }
  return entries;
}

function readNumber(entry: StatsEntry, key: string): number | null {
  const value = entry[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readText(entry: StatsEntry, key: string): string | null {
  const value = entry[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The round trip of the candidate pair actually carrying the media.
 *
 * A connection reports every pair it ever tried, including the ones that failed, so the pair is
 * chosen rather than taken first: the one the connection says it selected, or failing that a
 * nominated pair that succeeded. Reading whichever pair came first would report the round trip of a
 * path nothing is using.
 */
function readRoundTrip(entries: readonly StatsEntry[]): number | null {
  const pairs = entries.filter((entry) => readText(entry, "type") === "candidate-pair");
  const inUse =
    pairs.find((entry) => entry.selected === true) ??
    pairs.find((entry) => entry.nominated === true && readText(entry, "state") === "succeeded") ??
    pairs.find((entry) => readNumber(entry, "currentRoundTripTime") !== null);
  if (inUse === undefined) return null;
  const seconds = readNumber(inUse, "currentRoundTripTime");
  return seconds === null ? null : seconds * 1000;
}

/**
 * What this browser's camera is sending, and what the far end says it is getting of it.
 *
 * The loss and the jitter of an OUTBOUND stream are not measurable here — they happen after the
 * packets leave — so they come from the `remote-inbound-rtp` entry, which is the unit's own report
 * about this browser's stream sent back. Without it an uplink can only ever be judged on its round
 * trip, which is honest and is what the nulls say.
 */
function readUplink(
  entries: readonly StatsEntry[],
  previous: ConnectionSample | null,
  elapsedSeconds: number | null,
  context: SampleContext,
): UplinkSample | null {
  const outbound = entries.filter(
    (entry) => readText(entry, "type") === "outbound-rtp" && readText(entry, "kind") === "video",
  );
  const camera = chooseCamera(outbound, context.screenMid ?? null);
  if (camera === null) return null;

  const id = readText(camera, "id") ?? "";
  const remote = entries.find(
    (entry) =>
      readText(entry, "type") === "remote-inbound-rtp" && readText(entry, "localId") === id,
  );

  const bytesSent = readNumber(camera, "bytesSent") ?? 0;
  const packetsSent = readNumber(camera, "packetsSent") ?? 0;
  const packetsLost = remote === undefined ? null : readNumber(remote, "packetsLost");
  const jitterSeconds = remote === undefined ? null : readNumber(remote, "jitter");

  const before = previous?.uplink ?? null;
  const sameStream = before !== null && before.id === id;
  const bitsPerSecond =
    sameStream && elapsedSeconds !== null && elapsedSeconds > 0
      ? (Math.max(0, bytesSent - before.bytesSent) * 8) / elapsedSeconds
      : null;

  return {
    id,
    mid: readText(camera, "mid"),
    rid: readText(camera, "rid"),
    frameWidth: readNumber(camera, "frameWidth"),
    frameHeight: readNumber(camera, "frameHeight"),
    bytesSent,
    packetsSent,
    packetsLost,
    framesSent: readNumber(camera, "framesSent") ?? 0,
    bitsPerSecond,
    // The round trip on a remote report is the same path figure the candidate pair gives, so it is
    // left to the sample rather than stated twice and allowed to disagree.
    roundTripMilliseconds: null,
    lossFraction:
      sameStream && packetsLost !== null
        ? lossOver(packetsLost - (before.packetsLost ?? 0), packetsSent - before.packetsSent)
        : null,
    jitterMilliseconds: jitterSeconds === null ? null : jitterSeconds * 1000,
  };
}

/**
 * Which outbound video publication is the camera.
 *
 * The screen share is named where the caller knows its media section, which is the only certain
 * answer. Failing that the camera is the one offered as simulcast layers — it publishes three and a
 * share publishes one — and failing THAT it is whichever is sending, which is the right answer in
 * the ordinary room where there is only one.
 */
function chooseCamera(
  outbound: readonly StatsEntry[],
  screenMid: string | null,
): StatsEntry | null {
  const candidates =
    screenMid === null
      ? outbound
      : outbound.filter((entry) => readText(entry, "mid") !== screenMid);
  if (candidates.length === 0) return null;
  const layered = candidates.filter((entry) => readText(entry, "rid") !== null);
  const considered = layered.length > 0 ? layered : candidates;
  // The largest layer actually going out is the one that describes what the room is being sent;
  // the two smaller ones are the same picture again.
  return (
    considered.reduce<StatsEntry | null>((best, entry) => {
      if (best === null) return entry;
      return (readNumber(entry, "bytesSent") ?? 0) > (readNumber(best, "bytesSent") ?? 0)
        ? entry
        : best;
    }, null) ?? null
  );
}

/** Everything coming in, each stream against its own previous reading. */
function readInbound(
  entries: readonly StatsEntry[],
  previous: ConnectionSample | null,
  context: SampleContext,
): InboundSample[] {
  const before = new Map((previous?.inbound ?? []).map((entry) => [entry.id, entry] as const));
  const samples: InboundSample[] = [];

  for (const entry of entries) {
    if (readText(entry, "type") !== "inbound-rtp") continue;
    const kind = readText(entry, "kind");
    if (kind !== "audio" && kind !== "video") continue;

    const id = readText(entry, "id") ?? "";
    const mid = readText(entry, "mid");
    const packetsLost = readNumber(entry, "packetsLost") ?? 0;
    const packetsReceived = readNumber(entry, "packetsReceived") ?? 0;
    const jitterSeconds = readNumber(entry, "jitter");
    const was = before.get(id) ?? null;

    samples.push({
      id,
      mid,
      participantId: mid === null ? null : (context.ownerOfMid?.(mid) ?? null),
      kind,
      packetsLost,
      packetsReceived,
      bytesReceived: readNumber(entry, "bytesReceived") ?? 0,
      framesReceived: readNumber(entry, "framesReceived") ?? 0,
      framesDropped: readNumber(entry, "framesDropped") ?? 0,
      roundTripMilliseconds: null,
      lossFraction:
        was === null
          ? null
          : lossOver(packetsLost - was.packetsLost, packetsReceived - was.packetsReceived),
      jitterMilliseconds: jitterSeconds === null ? null : jitterSeconds * 1000,
    });
  }
  return samples;
}

/**
 * The share of packets lost over an interval: what went missing, against everything that was sent.
 *
 * Null where nothing moved at all — a stream that carried no packets in five seconds has not lost
 * any, and reporting zero loss for it would say a dead track is in perfect health. A counter that
 * went BACKWARDS is a stream that was replaced under the same handle, and is read the same way.
 */
function lossOver(lost: number, delivered: number): number | null {
  if (lost < 0 || delivered < 0) return null;
  const total = lost + delivered;
  return total === 0 ? null : lost / total;
}
