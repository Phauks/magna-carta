/*
 * The engine's lifecycle as reactive state. Cloudflare's measurement engine is imported lazily on
 * the first run: it is browser-only (it reads PerformanceResourceTiming) and there is no reason to
 * ship it to anyone who never presses Start.
 *
 * The engine runs Cloudflare's own measurement ladder, with its `packetLoss` step included only
 * when the TURN relay credentials behind it are actually obtainable (see turn-capability.ts) —
 * asked BEFORE the engine is built, never mid-run. That step needs a WebRTC TURN server; a refused
 * credential mid-run used to abort the whole test, taking the bandwidth and latency results with
 * it. Every other phase is Cloudflare's, unchanged, which is what keeps these numbers comparable to
 * speed.cloudflare.com. A run transfers a lot of data, which is why nothing starts without an
 * explicit press, and why dispose() pauses the engine when the page goes away: a backgrounded tab
 * must never keep spending the firm's bandwidth.
 */
import type { BandwidthPoint, Results, Scores } from "@cloudflare/speedtest";
import {
  probeConnection,
  type ConnectionFacts,
  type FetchResult,
  type ProbeOutcome,
} from "./connection-probe.ts";
import { LADDER_WITH_PACKET_LOSS, MEASUREMENT_LADDER } from "./measurement-ladder.ts";
import { fetchMeasurementServer, type MeasurementServer } from "./speed-test-meta.ts";
import { probeTurnCapability, TURN_CREDENTIALS_URL, type TurnCapability } from "./turn-capability.ts";

export type SpeedTestPhase = "idle" | "running" | "paused" | "finished" | "failed";

// Structural view of the engine's Results — only what this page renders. Reconciled against
// dist/speedtest.d.ts; the method names and return types are the library's, not ours.
export interface SpeedTestResults {
  getDownloadBandwidth(): number | undefined;
  getUploadBandwidth(): number | undefined;
  getUnloadedLatency(): number | undefined;
  getUnloadedJitter(): number | undefined;
  getDownLoadedLatency(): number | undefined;
  getUpLoadedLatency(): number | undefined;
  getDownloadBandwidthPoints(): readonly BandwidthPoint[];
  getUploadBandwidthPoints(): readonly BandwidthPoint[];
  getUnloadedLatencyPoints(): readonly number[];
  getDownLoadedLatencyPoints(): readonly number[];
  getUpLoadedLatencyPoints(): readonly number[];
  getScores(): Scores;
  getPacketLoss(): number | undefined;
}

/*
 * The engine hands back the SAME `Results` instance on every call — it mutates `raw` in place
 * rather than replacing itself (per its own doc comment: "Updated in-place by the engine as
 * results arrive"). Svelte's `$state` marks a reassignment dirty by reference: reassigning the
 * identical instance on every `onResultsChange` would be a silent no-op, and the page would never
 * repaint until (maybe) the final `onFinish` call. Wrapping each getter in a fresh plain object
 * gives every publish a new reference, so the state update is never skipped, while every method
 * still reads live off the one real instance.
 */
function snapshotResults(source: Results): SpeedTestResults {
  return {
    getDownloadBandwidth: () => source.getDownloadBandwidth(),
    getUploadBandwidth: () => source.getUploadBandwidth(),
    getUnloadedLatency: () => source.getUnloadedLatency(),
    // The library allows `null` (fewer than 2 samples); this page treats "not enough data yet"
    // the same as "not measured yet".
    getUnloadedJitter: () => source.getUnloadedJitter() ?? undefined,
    getDownLoadedLatency: () => source.getDownLoadedLatency(),
    getUpLoadedLatency: () => source.getUpLoadedLatency(),
    getDownloadBandwidthPoints: () => source.getDownloadBandwidthPoints(),
    getUploadBandwidthPoints: () => source.getUploadBandwidthPoints(),
    getUnloadedLatencyPoints: () => source.getUnloadedLatencyPoints(),
    getDownLoadedLatencyPoints: () => source.getDownLoadedLatencyPoints(),
    getUpLoadedLatencyPoints: () => source.getUpLoadedLatencyPoints(),
    getScores: () => source.getScores(),
    getPacketLoss: () => source.getPacketLoss(),
  };
}

// Never throws: the probe needs to tell a refusal (the platform answered "no") apart from a
// transport failure (nothing answered at all), and an exception erases that distinction.
async function fetchConnectionFacts(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, facts: (await response.json()) as ConnectionFacts };
  } catch {
    return { ok: false, status: null };
  }
}

// fetchMeasurementServer treats a thrown error as "nothing to say", so a non-OK response is
// thrown here rather than swallowed silently.
async function fetchMeta(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`meta responded ${response.status}`);
  return response.json();
}

// probeTurnCapability reads only the status: a transport failure is distinguished by `fetch`
// itself throwing, never by an inspected response.
async function fetchTurnStatus(url: string): Promise<number> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return response.status;
}

export function createSpeedTestStore() {
  let phase = $state<SpeedTestPhase>("idle");
  let results = $state<SpeedTestResults | null>(null);
  let error = $state<string | null>(null);
  let probe = $state<ProbeOutcome | null>(null);
  let meta = $state<MeasurementServer | null>(null);
  // Cleared at the top of every run: this is the run in front of you, never a history.
  let finishedAt = $state<Date | null>(null);
  // Whether the relay credentials packet loss needs could be had — decided BEFORE the engine is
  // built (see turn-capability.ts), never discovered mid-run. Null until the first run asks it.
  let turn = $state<TurnCapability | null>(null);

  // The engine instance, once the module has been fetched. Not reactive: nothing renders it
  // directly — only its published (snapshotted) results and phase matter to the template. The
  // callbacks are wired once on `instance` at construction time (below), so this narrower type
  // only needs to cover what is called on `engine` afterwards. The ladder is fixed at construction
  // (measurements is a constructor-only option), so a capability change is never applied by mutating
  // an existing instance — only by disposing it and building a fresh one (see restart()).
  let engine: {
    play(): void;
    pause(): void;
  } | null = null;

  function runProbe(): void {
    // Runs alongside the benchmark and fails independently: an unreachable platform must not
    // abort the connection measurement, and vice versa.
    void probeConnection({ fetchJson: fetchConnectionFacts, now: () => performance.now() }).then(
      (outcome) => {
        probe = outcome;
      },
    );
  }

  // Loaded once, at store creation — not on Start. Cloudflare's own page names the measurement
  // server before a run begins, and the meta endpoint needs no session to answer.
  void fetchMeasurementServer(fetchMeta).then((server) => {
    meta = server;
  });

  // capability is decided BEFORE the engine is built (in start()/restart()) — never inside here —
  // because the ladder is a constructor-only option: it cannot be changed on a live instance.
  async function ensureEngine(capability: TurnCapability): Promise<void> {
    if (engine !== null) return;
    const { default: SpeedTest } = await import("@cloudflare/speedtest");
    // autoStart is false: a run spends the firm's bandwidth and only a press may begin it.
    const options = capability.available
      ? {
          autoStart: false,
          measurements: LADDER_WITH_PACKET_LOSS,
          // The default points at Cloudflare's discontinued public relay; ours is the Realtime one.
          turnServerUri: "turn.cloudflare.com:3478",
          turnServerCredsApiUrl: TURN_CREDENTIALS_URL,
        }
      : { autoStart: false, measurements: MEASUREMENT_LADDER };
    const instance = new SpeedTest(options);
    instance.onResultsChange = () => {
      results = snapshotResults(instance.results);
    };
    instance.onFinish = (finished) => {
      results = snapshotResults(finished);
      phase = "finished";
      finishedAt = new Date();
    };
    instance.onError = (message) => {
      error = message;
      phase = "failed";
    };
    engine = instance;
  }

  async function beginRun(): Promise<void> {
    phase = "running";
    runProbe();
    try {
      // Ask BEFORE building the engine: a credential refusal discovered mid-run would abort the
      // entire test, taking the bandwidth and latency results with it.
      turn = await probeTurnCapability(fetchTurnStatus);
      await ensureEngine(turn);
      engine?.play();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      phase = "failed";
    }
  }

  async function start(): Promise<void> {
    error = null;
    finishedAt = null;
    await beginRun();
  }

  function pause(): void {
    engine?.pause();
    phase = "paused";
  }

  function resume(): void {
    engine?.play();
    phase = "running";
  }

  async function restart(): Promise<void> {
    results = null;
    error = null;
    probe = null;
    finishedAt = null;
    // Disposed rather than reused: the capability may have changed (a member who signed in mid-
    // session), and the ladder can only be set when a new instance is constructed.
    engine?.pause();
    engine = null;
    await beginRun();
  }

  /** Leaving the page must stop the transfer — a background tab never keeps spending bandwidth. */
  function dispose(): void {
    engine?.pause();
    engine = null;
  }

  return {
    get phase() {
      return phase;
    },
    get results() {
      return results;
    },
    get error() {
      return error;
    },
    get probe() {
      return probe;
    },
    get meta() {
      return meta;
    },
    get finishedAt() {
      return finishedAt;
    },
    get turn() {
      return turn;
    },
    start,
    pause,
    resume,
    restart,
    dispose,
  };
}
