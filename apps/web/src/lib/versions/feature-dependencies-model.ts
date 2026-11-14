/*
 * What each feature runs on, as the System Status page's Features and Workers tab shows it: the
 * fleet Worker that backs it and the outside services it calls, each with its own health. The
 * Worker rows and the feature rows used to be separate tabs, and a reader had to know that
 * "Malware scanning" means `magna-carta-scan` to join them; this file does the join.
 *
 * Two kinds of dependency:
 * - A WORKER, read off the versions read's `services` rows: whether it answers, and which build it
 *   is running and when that build was made.
 * - An OUTSIDE SERVICE, an API somebody else runs. Where the API runs a live check
 *   (`connectedServices`), the chip reports that. Where it does not, because a check would be
 *   billed per call or no free check exists, the chip says whether its settings are present, and
 *   says that it was not checked live, so "the key is set" never reads as "the service accepted it".
 *
 * Every feature also runs on `magna-carta` and `magna-carta-web`; those two head the tab once
 * rather than repeating under all thirty features.
 *
 * Pure, like the panel's other models, so the words are testable without a browser.
 */
import { FEATURE_WORKERS, type FeatureRequirements, type FeatureState } from "./features-model.ts";
import {
  describeProbeLatency,
  formatVersionTimestamp,
  isSlowProbe,
  type ServiceVersionRow,
} from "./version-overlay-model.ts";

/** How a dependency chip reads: its dot, and whether it is the reason a feature is down. */
export type DependencyTone = "healthy" | "attention" | "fault" | "idle";

export interface DependencyChip {
  readonly key: string;
  readonly kind: "worker" | "service";
  /** A Worker's deployed name, or an outside service's own name. */
  readonly name: string;
  readonly tone: DependencyTone;
  /** One or two words: Answering, Not answering, Connected, Key set, Not set up. */
  readonly status: string;
  /** The rest: build, build time and probe time for a Worker; what was checked for a service. */
  readonly detail: string | null;
  /** The Worker to open in the Cloudflare dashboard, or null. */
  readonly dashboardWorker: string | null;
}

/** A live check the versions read may carry. Its id is the API's `connectedServices` id. */
export interface ConnectedServiceReading {
  readonly id: string;
  readonly state: "connected" | "not-configured" | "refused" | "unreachable";
  readonly latencyMilliseconds: number | null;
}

export interface OutsideService {
  readonly name: string;
  /** The `connectedServices` id of its live check, or null where there is none. */
  readonly liveCheck: string | null;
  /** The settings it reads on the magna-carta Worker. Empty for one with no integration yet. */
  readonly settings: readonly string[];
  /** Why there is no live check, said on the chip. */
  readonly noLiveCheckReason?: string;
}

const BILLED = "Not checked live: each call is billed";
const NO_FREE_CHECK = "Not checked live";

/*
 * The outside APIs each feature calls, in the order its chips read. A feature with none runs
 * entirely on our own Workers. The setting names mirror the API roster's requirements
 * (apps/api-worker/src/system-status/feature-roster.ts); test/system-status-features.test.ts holds
 * every name here to a name the roster carries, so a renamed secret fails there.
 */
export const FEATURE_OUTSIDE_SERVICES: Record<string, readonly OutsideService[]> = {
  meetings: [
    {
      name: "Cloudflare Realtime",
      liveCheck: "realtime",
      settings: ["REALTIME_SFU_APP_ID", "REALTIME_SFU_APP_SECRET"],
    },
  ],
  networkPacketLoss: [
    {
      name: "Cloudflare Realtime TURN",
      liveCheck: null,
      settings: ["REALTIME_TURN_TOKEN_ID", "REALTIME_TURN_TOKEN_SECRET"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  callerLookup: [
    { name: "Telnyx", liveCheck: null, settings: ["TELNYX_API_KEY"], noLiveCheckReason: BILLED },
  ],
  outlookCalendarSync: [
    {
      name: "Microsoft",
      liveCheck: "microsoftCalendar",
      settings: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  googleCalendarSync: [
    {
      name: "Google Calendar",
      liveCheck: "googleCalendar",
      settings: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  outgoingEmail: [
    {
      name: "Cloudflare Email Service",
      liveCheck: null,
      settings: ["SEND_EMAIL", "EMAIL_FROM"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  notificationDigest: [
    {
      name: "Cloudflare Email Service",
      liveCheck: null,
      settings: ["SEND_EMAIL", "EMAIL_FROM"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  directUpload: [
    {
      name: "R2 storage API",
      liveCheck: null,
      settings: ["R2_S3_ACCESS_KEY_ID", "R2_S3_SECRET_ACCESS_KEY"],
      noLiveCheckReason: "Checked by Upload readiness on the This Firm tab",
    },
  ],
  passwordRecovery: [
    // The slow-password rung has a place in the recovery job and no provider behind it yet, so it
    // reads as not set up until one is chosen and wired.
    { name: "GPU compute (slow passwords)", liveCheck: null, settings: [] },
  ],
  naturalLanguageSearch: [
    {
      name: "Cloudflare AI Search",
      liveCheck: null,
      settings: ["AI_SEARCH"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  addressSuggestions: [
    {
      name: "Google Places",
      liveCheck: null,
      settings: ["GOOGLE_PLACES_API_KEY"],
      noLiveCheckReason: BILLED,
    },
    {
      name: "Smarty",
      liveCheck: null,
      settings: ["SMARTY_AUTH_ID", "SMARTY_AUTH_TOKEN"],
      noLiveCheckReason: BILLED,
    },
  ],
  aiTextDetection: [
    { name: "Pangram", liveCheck: null, settings: ["PANGRAM_API_KEY"], noLiveCheckReason: BILLED },
  ],
  modelAvailabilityCheck: [
    {
      name: "Anthropic",
      liveCheck: null,
      settings: ["ANTHROPIC_MODELS_API_KEY"],
      noLiveCheckReason: "Checked when Settings, AI lists the models",
    },
  ],
  signUpBotCheck: [
    {
      name: "Cloudflare Turnstile",
      liveCheck: null,
      settings: ["TURNSTILE_SECRET_KEY"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  featureFlags: [
    {
      name: "Cloudflare Flagship",
      liveCheck: null,
      settings: ["FLAGS"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  usageAnalytics: [
    {
      name: "Workers Analytics Engine",
      liveCheck: null,
      settings: ["TELEMETRY"],
      noLiveCheckReason: NO_FREE_CHECK,
    },
  ],
  recentErrors: [
    {
      name: "Workers Observability",
      liveCheck: null,
      settings: ["OBSERVABILITY_API_TOKEN"],
      noLiveCheckReason: "Checked when Recent Errors loads",
    },
  ],
};

/** The chip for one fleet Worker, from its row in the versions read (or its absence). */
export function workerChip(worker: string, row: ServiceVersionRow | undefined): DependencyChip {
  const base = { key: `worker:${worker}`, kind: "worker" as const, name: worker };
  if (row === undefined) {
    return { ...base, tone: "idle", status: "Not reported", detail: null, dashboardWorker: null };
  }
  if (row.state === "reported") {
    const built = formatVersionTimestamp(row.buildTime);
    const latency = describeProbeLatency(row.latencyMilliseconds);
    const detail = [
      row.commit,
      built === null ? null : `built ${built}`,
      latency === null ? null : `answered in ${latency}`,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
    const slow = isSlowProbe(row.latencyMilliseconds);
    return {
      ...base,
      tone: slow ? "attention" : "healthy",
      status: slow ? "Slow" : "Answering",
      detail: detail.length === 0 ? null : detail,
      dashboardWorker: worker,
    };
  }
  if (row.state === "unreachable") {
    return {
      ...base,
      tone: "fault",
      status: "Not answering",
      detail: "Couldn't connect. Open it in Cloudflare to see why.",
      dashboardWorker: worker,
    };
  }
  if (row.state === "unbound") {
    return {
      ...base,
      tone: "idle",
      status: "Not bound",
      detail: "Not bound to magna-carta",
      dashboardWorker: null,
    };
  }
  return {
    ...base,
    tone: "attention",
    status: "No version",
    detail: "Answers from a build too old to report one",
    dashboardWorker: worker,
  };
}

const LIVE_CHECK_WORDS: Record<
  ConnectedServiceReading["state"],
  { tone: DependencyTone; status: string }
> = {
  connected: { tone: "healthy", status: "Connected" },
  "not-configured": { tone: "idle", status: "Not set up" },
  refused: { tone: "fault", status: "Refused the key" },
  unreachable: { tone: "fault", status: "Not answering" },
};

/** Which settings are present, from a platform operator's requirements; null for anyone else. */
function presentSettings(
  requirements: FeatureRequirements | undefined,
): Map<string, boolean> | null {
  if (requirements === undefined) return null;
  const present = new Map<string, boolean>();
  for (const alternative of requirements.alternatives) {
    for (const requirement of alternative) present.set(requirement.name, requirement.present);
  }
  return present;
}

/** The chip for one outside service a feature calls. */
export function outsideServiceChip(
  service: OutsideService,
  input: {
    readonly featureState: FeatureState;
    readonly connectedServices: readonly ConnectedServiceReading[];
    readonly requirements: FeatureRequirements | undefined;
  },
): DependencyChip {
  const base = {
    key: `service:${service.name}`,
    kind: "service" as const,
    name: service.name,
    dashboardWorker: null,
  };
  if (service.settings.length === 0) {
    return { ...base, tone: "idle", status: "Not set up", detail: "No provider is connected yet" };
  }
  const live =
    service.liveCheck === null
      ? undefined
      : input.connectedServices.find((reading) => reading.id === service.liveCheck);
  if (live !== undefined) {
    const latency = describeProbeLatency(live.latencyMilliseconds);
    return {
      ...base,
      ...LIVE_CHECK_WORDS[live.state],
      detail:
        live.state === "connected" && latency !== null ? `checked just now, ${latency}` : null,
    };
  }
  const present = presentSettings(input.requirements);
  if (present !== null) {
    const missing = service.settings.filter((name) => present.get(name) !== true);
    if (missing.length > 0) {
      return { ...base, tone: "idle", status: "Not set up", detail: `Needs ${missing.join(", ")}` };
    }
    return {
      ...base,
      tone: "healthy",
      status: "Key set",
      detail: service.noLiveCheckReason ?? NO_FREE_CHECK,
    };
  }
  // A member sees no setting names; the feature's own state stands in for the service's.
  if (input.featureState === "not-set-up") {
    return { ...base, tone: "idle", status: "Not set up", detail: null };
  }
  return { ...base, tone: "healthy", status: "Set up", detail: null };
}

/** Every chip a feature's row carries: its Worker first, then the outside services it calls. */
export function featureDependencyChips(
  feature: { readonly id: string; readonly state: FeatureState },
  input: {
    readonly services: readonly ServiceVersionRow[];
    readonly connectedServices: readonly ConnectedServiceReading[];
    readonly requirements: FeatureRequirements | undefined;
  },
): DependencyChip[] {
  const chips: DependencyChip[] = [];
  const worker = FEATURE_WORKERS[feature.id];
  if (worker !== undefined) {
    chips.push(
      workerChip(
        worker,
        input.services.find((row) => row.service === worker),
      ),
    );
  }
  for (const service of FEATURE_OUTSIDE_SERVICES[feature.id] ?? []) {
    chips.push(outsideServiceChip(service, { ...input, featureState: feature.state }));
  }
  return chips;
}

/**
 * The fleet Workers no feature names, beside the web Worker that heads the tab: the platform's own
 * machinery (the status page Worker, for one). Listed under the features so the tab still accounts
 * for the whole fleet, which is what the Workers tab it replaced promised.
 */
export function workersOutsideFeatures(
  services: readonly ServiceVersionRow[],
  webWorkerId: string,
): ServiceVersionRow[] {
  const named = new Set(Object.values(FEATURE_WORKERS));
  return services.filter((row) => row.id !== webWorkerId && !named.has(row.service));
}

/** One line per feature for the copied report: the feature, then each of its dependencies. */
export function copyLineForDependencies(chips: readonly DependencyChip[]): string | null {
  if (chips.length === 0) return null;
  return chips.map((chip) => `${chip.name} ${chip.status}`).join("; ");
}
