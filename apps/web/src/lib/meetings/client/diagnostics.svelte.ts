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
 * NOTHING IS SENT ANYWHERE YET. `report()` assembles the redacted snapshot and `sendReport` is the
 * seam it will go out through; the room's side of diagnostics — the frame, the handler, the
 * per-meeting event stream — is the next slice of this wave, and until it exists a client that
 * invented a frame would only be refused.
 */
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
  | "protocol-mismatch";

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

/** What the client lets diagnostics ask about the connection it is sampling. */
export interface DiagnosticsSource {
  /** The connection's own statistics. Null where there is no connection to ask. */
  readStats: () => Promise<StatsReportLike | null> | null;
  /** Who the track on a media section belongs to, as the subscriptions module knows it. */
  ownerOfMid: (mid: string) => string | null;
  /** The media section a screen share is going out on, which is not the camera. */
  screenMid: () => string | null;
  /** This browser's own participant, for a report to be correlated by. */
  participantId: () => string | null;
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
   * Send the snapshot to the room.
   *
   * Nothing, deliberately, and not for want of a caller: the room has no frame to receive it on and
   * no handler for one. The frame, the room's handler and the per-meeting event stream are the next
   * slice of this wave; when they land this is the one place that sends it, and every surface above
   * is already reading from the same snapshot.
   */
  sendReport(): void {}

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
