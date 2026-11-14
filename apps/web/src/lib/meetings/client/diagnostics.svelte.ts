/*
 * Why a meeting is going badly, kept where the meeting is going badly.
 *
 * WHAT THIS HOLDS, AND FOR HOW LONG. Two short rings: the last few minutes of connection samples,
 * and the last few dozen things that happened on the wire. Both live in this browser's memory and
 * nowhere else — nothing here is written to storage, nothing is put on the meeting's record, and a
 * page that is closed takes all of it with it. A meeting's record is who was in the room and for
 * how long; how somebody's connection was behaving is not a fact about the meeting and must never
 * become one.
 *
 * WHAT IT IS FOR. A member whose colleague is breaking up has one question — is it me? — and a room
 * that cannot answer it leaves them toggling their camera. The mark on a tile answers it, and the
 * details sheet behind it carries the numbers somebody diagnosing it would otherwise have to open a
 * browser console for.
 *
 * THE EVENTS ARE SHAPES, NOT CONTENT. A note carries what happened, a count where a count is the
 * point, and an Error ID where the room issued one. Never a name, never a track name, never a
 * session description: the standard the whole product logs by is redact-by-default
 * (docs/conventions/error-logging.md), and a ring buffer that ends up in a report is exactly where
 * that stops being theoretical.
 *
 * WHAT LEAVES THIS BROWSER IS THE MEASUREMENT AND NOTHING ELSE. `report()` assembles the redacted
 * snapshot every surface here reads, and `sendReport` puts the NUMBERS on the wire: rates, counts
 * and one enum, bounded by the protocol's own ceilings. The ring of events stays here — it is the
 * one thing in this file shaped like prose, and prose is where a name gets in.
 */
import {
  MAX_DIAGNOSTIC_BITS_PER_SECOND,
  MAX_DIAGNOSTIC_INBOUND_COUNT,
  MAX_DIAGNOSTIC_JITTER_MILLISECONDS,
  MAX_DIAGNOSTIC_PIXELS,
  MAX_DIAGNOSTIC_ROUND_TRIP_MILLISECONDS,
  type MeetingDiagnosticSample,
} from "@magna-carta/meeting-protocol/frames";
import { PREFERRED_RIDS, type PreferredRid } from "@magna-carta/meeting-protocol/types";
import { diagnosticText, type DiagnosticEnvironment } from "./diagnostic-text.ts";
import {
  inboundFacts,
  qualityOf,
  summarizeStats,
  uplinkFacts,
  type ConnectionQuality,
  type ConnectionSample,
  type StatsReportLike,
} from "./connection-quality.ts";

/** How often a live meeting's connection is read. */
export const SAMPLE_INTERVAL_MILLISECONDS = 5_000;

/**
 * How many samples are kept: five minutes at the interval above.
 *
 * It is a window rather than a log. What a member or a support reader needs is what the connection
 * has been doing recently enough to still be true; an hour of samples is a data set nobody reads
 * and a number that only ever climbs in a tab somebody leaves open all day.
 */
export const SAMPLES_KEPT = 60;

/** How many wire events are kept. Long enough to hold a join and what went wrong after it. */
export const EVENTS_KEPT = 60;

/**
 * How often a measurement may go out, and it is the ROOM's window rather than this browser's taste.
 *
 * The room takes one report per participant per window and drops the rest, exactly as it drops a
 * `sync` that follows too closely on the last one. That matters here because the tick is not the
 * only thing that takes a reading: a member opening the connection surface samples on the spot, and
 * without this guard that reading would spend the window the next scheduled report was going to use.
 * A sample is a restatement and the next one is along in a moment, so the one that is dropped is
 * never the one worth having.
 */
export const REPORT_INTERVAL_MILLISECONDS = 5_000;

/**
 * What happened, in the room's own vocabulary rather than a member's.
 *
 * The list is closed on purpose: an event kind is a shape, and a free-text kind is how a name or a
 * track ends up in a ring buffer that a report reads.
 */
export type DiagnosticEventKind =
  | "join"
  | "welcome"
  | "publish"
  | "subscribe"
  | "subscribed"
  | "layer"
  | "refused"
  | "superseded"
  | "socket-lost"
  | "ended"
  | "protocol-mismatch"
  /*
   * What the picture did on this page, rather than on the wire: a tile given a different stream to
   * play (detail: where it sits), this browser's own camera track replaced, and the view changing
   * shape (detail: what changed). A flash on screen with no wire event beside it is one of these, or
   * the browser's own drawing.
   */
  | "picture"
  | "camera-track"
  | "view";

/** One thing that happened on the wire. */
export interface DiagnosticEvent {
  /** When, on this browser's clock. */
  readonly at: number;
  readonly kind: DiagnosticEventKind;
  /**
   * What it was about, where a shape can say it: a count of tracks, a refusal reason. Never a name,
   * a track name or anything a person typed.
   */
  readonly detail: string | null;
  /** The room's own correlation handle, where its failure reached the logging pipeline. */
  readonly errorId: string | null;
}

/** What a module says when something happens. Everything about it is optional but the kind. */
export interface DiagnosticNote {
  readonly kind: DiagnosticEventKind;
  readonly detail?: string | null;
  readonly errorId?: string | null;
}

/**
 * Where a client module sends what happened.
 *
 * It is a seam rather than a direct reference so that signaling and subscriptions keep running
 * under a test with nothing listening, and so that neither of them has to know that diagnostics
 * exist at all.
 */
export interface DiagnosticsSink {
  note(event: DiagnosticNote): void;
}

/** The sink a module gets when nobody is listening. */
export function noOperationDiagnosticsSink(): DiagnosticsSink {
  return { note: () => {} };
}

/**
 * The ticking a live meeting is sampled on.
 *
 * A seam for the same reason the room's clock is one: a case about what five minutes of sampling
 * produces cannot wait five minutes, and a fake interval over the real one is a second thing to
 * keep in step with every other timer the client is running.
 */
export interface DiagnosticsTimer {
  /** Start ticking, and answer with the way to stop. */
  every(milliseconds: number, tick: () => void): () => void;
}

/** The timer as a browser supplies it. */
export function intervalDiagnosticsTimer(): DiagnosticsTimer {
  return {
    every: (milliseconds, tick) => {
      const ticking = setInterval(tick, milliseconds);
      return () => clearInterval(ticking);
    },
  };
}

/** What the client lets diagnostics ask about the connection, and where what it measures goes. */
export interface DiagnosticsSource {
  /** The connection's own statistics. Null where there is no connection to ask. */
  readStats: () => Promise<StatsReportLike | null> | null;
  /** Who the track on a media section belongs to, as the subscriptions module knows it. */
  ownerOfMid: (mid: string) => string | null;
  /** The media section a screen share is going out on, which is not the camera. */
  screenMid: () => string | null;
  /** This browser's own participant, for a report to be correlated by. */
  participantId: () => string | null;
  /**
   * Whether this browser is IN the room.
   *
   * Sampling starts with the connection, which is before a socket standing at a door has been let
   * through one — and the only frames such a socket may send are the keepalive and giving up. A
   * report sent from there is refused, and the refusal puts a notice on the screen of somebody who
   * did nothing but wait.
   */
  isLive: () => boolean;
  /** Where a frame this browser measured goes out, which is the signaling socket. */
  send: (frame: Record<string, unknown>) => void;
}

/** The redacted snapshot a periodic report will carry. */
export interface DiagnosticsReport {
  readonly at: number;
  /** Who this is, by the room's own handle. Never a name. */
  readonly participantId: string | null;
  /** How this browser's own sending is doing. */
  readonly quality: ConnectionQuality;
  readonly roundTripMilliseconds: number | null;
  readonly uplink: {
    readonly rid: string | null;
    readonly frameWidth: number | null;
    readonly frameHeight: number | null;
    readonly bitsPerSecond: number | null;
    readonly lossFraction: number | null;
    readonly jitterMilliseconds: number | null;
  } | null;
  /** How everybody else's media is arriving, by handle. */
  readonly participants: readonly {
    readonly participantId: string;
    readonly quality: ConnectionQuality;
    readonly lossFraction: number | null;
    readonly jitterMilliseconds: number | null;
  }[];
  readonly events: readonly DiagnosticEvent[];
}

/**
 * A measurement the wire will take, or nothing.
 *
 * Nothing covers both of the ways a number can be unreportable: nobody measured it, and what was
 * measured cannot be true. The protocol's ceilings are sanity bounds far above any working
 * connection, so a figure past one is a reading this browser should not be making a claim out of —
 * and clamping it would record a number nobody took, under a name that says somebody did.
 */
function within(measured: number | null, ceiling: number): number | undefined {
  if (measured === null || !Number.isFinite(measured)) return undefined;
  return measured < 0 || measured > ceiling ? undefined : measured;
}

/** A picture's edge, which the wire takes as a whole number of pixels. */
function pixels(measured: number | null): number | undefined {
  if (measured === null || !Number.isFinite(measured)) return undefined;
  const whole = Math.round(measured);
  return whole < 1 || whole > MAX_DIAGNOSTIC_PIXELS ? undefined : whole;
}

/** The simulcast layer the camera is going out as, where the connection named one of the three. */
function layerOf(rid: string | null): PreferredRid | undefined {
  return PREFERRED_RIDS.find((offered) => offered === rid);
}

export class MeetingDiagnostics implements DiagnosticsSink {
  /** How this browser's own sending is doing. `unknown` until the first sample lands. */
  quality = $state<ConnectionQuality>("unknown");
  /** The last sample, for the details surface to read the numbers off. Null before the first. */
  latest = $state<ConnectionSample | null>(null);
  /** The last few dozen things that happened on the wire, oldest first. */
  recent = $state<readonly DiagnosticEvent[]>([]);

  /** How each other participant's media is arriving. */
  #qualityByParticipant = $state<ReadonlyMap<string, ConnectionQuality>>(new Map());

  /**
   * The window of samples. NOT state: nothing renders the history, and a rune here would make every
   * one of the last sixty samples a dependency of anything reading the latest one.
   */
  #samples: ConnectionSample[] = [];

  readonly #timer: DiagnosticsTimer;
  #stopTicking: (() => void) | null = null;
  #source: DiagnosticsSource | null = null;
  /** True while a reading is in flight, so a slow connection cannot stack ticks on itself. */
  #reading = false;
  /** When the last report went out, on this browser's clock. Null while none has this meeting. */
  #reportedAt: number | null = null;

  constructor(timer: DiagnosticsTimer = intervalDiagnosticsTimer()) {
    this.#timer = timer;
  }

  /** Start sampling. Starting a running one restarts it rather than leaving two tickers. */
  start(source: DiagnosticsSource): void {
    this.stop();
    this.#source = source;
    this.#stopTicking = this.#timer.every(SAMPLE_INTERVAL_MILLISECONDS, () => {
      void this.sample();
    });
  }

  /**
   * Stop sampling, and let go of everything measured.
   *
   * The samples go with the meeting on purpose: they are about a connection that no longer exists,
   * and a client joining a second meeting would otherwise open it holding the last one's numbers.
   * The events are kept until the next join, because the last thing that happened is usually the
   * reason the meeting ended.
   */
  stop(): void {
    this.#stopTicking?.();
    this.#stopTicking = null;
    this.#source = null;
    this.#samples = [];
    this.#reading = false;
    this.#reportedAt = null;
    this.latest = null;
    this.quality = "unknown";
    this.#qualityByParticipant = new Map();
  }

  /** Forget everything, for a client being joined afresh. */
  clear(): void {
    this.stop();
    this.recent = [];
  }

  /** How one other person's media is arriving. */
  qualityOf(participantId: string): ConnectionQuality {
    return this.#qualityByParticipant.get(participantId) ?? "unknown";
  }

  /** Note something that happened on the wire. This is the `DiagnosticsSink` the modules hold. */
  note(event: DiagnosticNote): void {
    const noted: DiagnosticEvent = {
      at: Date.now(),
      kind: event.kind,
      detail: event.detail ?? null,
      errorId: event.errorId ?? null,
    };
    const kept = [...this.recent, noted];
    this.recent = kept.length > EVENTS_KEPT ? kept.slice(kept.length - EVENTS_KEPT) : kept;
  }

  /**
   * Take one reading. Public because the tick is not the only reason to take one — a member opening
   * the details surface wants the numbers as they are now, not as they were four seconds ago.
   */
  async sample(): Promise<void> {
    const source = this.#source;
    if (source === null || this.#reading) return;
    this.#reading = true;
    try {
      const report = await source.readStats();
      if (report === null || this.#source === null) return;
      const previous = this.#samples.at(-1) ?? null;
      const sample = summarizeStats(report, previous, Date.now(), {
        ownerOfMid: source.ownerOfMid,
        screenMid: source.screenMid() ?? null,
      });
      this.#keep(sample);
      // Measured and reported in one step, because a measurement nobody sends answers the question
      // this browser can answer and the room cannot: whether its own picture is arriving anywhere.
      // The window above is what keeps an on-demand reading from spending the scheduled one's turn.
      this.sendReport();
    } catch {
      // A connection that is being torn down rejects the ask, and a meeting is not worth ending
      // over a measurement. The marks stay where they were and the next tick asks again.
    } finally {
      this.#reading = false;
    }
  }

  /**
   * The redacted snapshot, for a report the room will one day take.
   *
   * WHAT IS NOT IN IT is the point: no session description, no track names, no display names,
   * nothing a person typed. Participants appear by the room's own handle, which is what a room
   * reading the report already holds and what correlating it to anything at all requires.
   */
  /**
   * The window as text to copy (diagnostic-text.ts): what each picture did over the last few
   * minutes, so a stutter that has already passed is still in it.
   */
  copyableText(environment: DiagnosticEnvironment): string {
    return diagnosticText(this.#samples, this.recent, environment);
  }

  report(): DiagnosticsReport {
    const sample = this.latest;
    const uplink = sample?.uplink ?? null;
    return {
      at: sample?.at ?? Date.now(),
      participantId: this.#source?.participantId() ?? null,
      quality: this.quality,
      roundTripMilliseconds: sample?.roundTripMilliseconds ?? null,
      uplink:
        uplink === null
          ? null
          : {
              rid: uplink.rid,
              frameWidth: uplink.frameWidth,
              frameHeight: uplink.frameHeight,
              bitsPerSecond: uplink.bitsPerSecond,
              lossFraction: uplink.lossFraction,
              jitterMilliseconds: uplink.jitterMilliseconds,
            },
      participants: [...this.#qualityByParticipant].map(([participantId, quality]) => {
        const facts = sample === null ? null : inboundFacts(sample, participantId);
        return {
          participantId,
          quality,
          lossFraction: facts?.lossFraction ?? null,
          jitterMilliseconds: facts?.jitterMilliseconds ?? null,
        };
      }),
      events: this.recent,
    };
  }

  /**
   * Put the latest measurement on the wire, where the room's window allows another one.
   *
   * THE FRAME CARRIES NUMBERS AND ONE ENUM. No session description, no track name, no display name,
   * nothing a person typed — the room records these through the standard telemetry pipeline and
   * keeps the last of them on the participant record, so an operator can see which END a bad
   * meeting is bad at. A browser's own handle is what correlates it, and the room already knows
   * which socket sent the frame, so the report does not restate it.
   *
   * EVERY FIELD IS OMITTED RATHER THAN INVENTED. A rate that has not been measured yet, and a
   * figure outside the protocol's own sanity bounds, are both left out: an absent field means "not
   * measured", and a clamped one would put a number in the record that nobody took.
   */
  sendReport(): void {
    const source = this.#source;
    const sample = this.latest;
    if (source === null || sample === null || !source.isLive()) return;
    const at = Date.now();
    if (this.#reportedAt !== null && at - this.#reportedAt < REPORT_INTERVAL_MILLISECONDS) return;
    this.#reportedAt = at;
    source.send({ type: "diagnostic-report", sample: this.#measurementOf(sample) });
  }

  /** The latest reading in the shape the wire takes it, bounded and with nothing measured omitted. */
  #measurementOf(sample: ConnectionSample): MeetingDiagnosticSample {
    const uplink = sample.uplink;
    return {
      quality: this.quality,
      roundTripMilliseconds: within(
        sample.roundTripMilliseconds,
        MAX_DIAGNOSTIC_ROUND_TRIP_MILLISECONDS,
      ),
      lossFraction: within(uplink?.lossFraction ?? null, 1),
      jitterMilliseconds: within(
        uplink?.jitterMilliseconds ?? null,
        MAX_DIAGNOSTIC_JITTER_MILLISECONDS,
      ),
      // Absent for somebody who joined to listen, and for a call, where there is no picture at all.
      outbound:
        uplink === null
          ? undefined
          : {
              rid: layerOf(uplink.rid),
              width: pixels(uplink.frameWidth),
              height: pixels(uplink.frameHeight),
              bitrate: within(uplink.bitsPerSecond, MAX_DIAGNOSTIC_BITS_PER_SECOND),
            },
      // What is arriving, not who: the count is what says whether a member seeing nothing is
      // subscribed to nothing or subscribed to everything and receiving none of it.
      inboundCount: within(sample.inbound.length, MAX_DIAGNOSTIC_INBOUND_COUNT),
    };
  }

  /** Keep a sample, judge everything it says, and let go of whatever fell out of the window. */
  #keep(sample: ConnectionSample): void {
    this.#samples.push(sample);
    if (this.#samples.length > SAMPLES_KEPT) this.#samples.shift();
    this.latest = sample;
    this.quality = qualityOf(uplinkFacts(sample));

    const judged = new Map<string, ConnectionQuality>();
    for (const entry of sample.inbound) {
      const participantId = entry.participantId;
      if (participantId === null || judged.has(participantId)) continue;
      judged.set(participantId, qualityOf(inboundFacts(sample, participantId)));
    }
    this.#qualityByParticipant = judged;
  }
}
