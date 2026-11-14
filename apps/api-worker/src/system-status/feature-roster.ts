/*
 * The features this deployment can switch on, and what each one needs from the account before it
 * works. The System Status page reads this to say, per feature, whether it is working, not set up,
 * or set up and failing — the question the Worker rows beside it could never answer, because a
 * member uses Outlook sync or address suggestions, not `magna-carta-address`.
 *
 * Each feature names its requirements as ALTERNATIVES: the feature is set up when every name in at
 * least one alternative is present in the environment. Address suggestions is the case that needs
 * several — the Google key, the platform's own address engine, or the Smarty key pair — and every
 * other feature has one. A name is a binding, a secret or a variable on this Worker (`keyof Bindings`), so a renamed
 * binding fails the type check here rather than leaving a row that can never turn green.
 *
 * Presence is all that is ever read. The value of a secret never leaves this module: the report
 * carries `present: true | false` per name, and for a secret that is present, whether it came from
 * the account's Secrets Store or from this Worker's own secret (`source`), and nothing else. Only a
 * platform operator is shown even that (meta-versions.ts).
 *
 * A feature backed by one of the fleet's Workers (`worker`) or by an outside service with a live
 * probe (`connectedService`) is judged by that probe once it is set up: a Worker that does not
 * answer, or a service that refuses the credentials, is a FAULT, which is a different remedy from
 * a setting nobody has made yet.
 */
import { secretSourcesOf } from "@magna-carta/worker-secrets/stored-secrets";
import type { Bindings } from "../bindings.ts";
import { API_WORKER_SECRET_NAMES } from "../stored-secret-names.ts";
import type { ConnectedServiceStatusReport } from "../meetings/sfu/realtime-status.ts";

/** A name the environment carries, or does not. */
export type RequirementName = keyof Bindings;

export interface FeatureDefinition {
  readonly id: string;
  /** Set up when every name in at least one alternative is present. */
  readonly alternatives: readonly (readonly RequirementName[])[];
  /** The fleet Worker (SERVICE_VERSION_ROSTER id) whose answer decides health once set up. */
  readonly worker?: string;
  /** The outside service whose probe decides health once set up. */
  readonly connectedService?: ConnectedServiceStatusReport["id"];
}

/*
 * In display order within the page's groups (the web model owns the groups and the words). Every
 * Worker in the fleet that powers a member-facing feature appears here under that feature; the
 * status Worker and the web Worker do not, because they are the platform itself rather than
 * something a firm switches on.
 */
export const FEATURE_ROSTER = [
  // Meetings and calls
  {
    id: "meetings",
    alternatives: [["REALTIME_SFU_APP_ID", "REALTIME_SFU_APP_SECRET"]],
    connectedService: "realtime",
  },
  {
    id: "meetingRecording",
    alternatives: [["MEETING_SINK_SIGNING_KEY", "MEETING_RECORDER", "MEETING_RECORDING_COMPOSE"]],
  },
  {
    id: "networkPacketLoss",
    alternatives: [["REALTIME_TURN_TOKEN_ID", "REALTIME_TURN_TOKEN_SECRET"]],
  },
  { id: "callerLookup", alternatives: [["TELNYX_API_KEY"]] },
  // Calendar and email
  { id: "outlookCalendarSync", alternatives: [["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]] },
  { id: "googleCalendarSync", alternatives: [["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"]] },
  { id: "outgoingEmail", alternatives: [["SEND_EMAIL", "EMAIL_FROM"]] },
  { id: "notificationDigest", alternatives: [["SEND_EMAIL", "EMAIL_FROM", "APP_BASE_URL"]] },
  { id: "emailCapture", alternatives: [["EMAIL_SERVICE"]], worker: "email" },
  // Files and documents
  {
    id: "directUpload",
    alternatives: [
      ["R2_S3_ACCESS_KEY_ID", "R2_S3_SECRET_ACCESS_KEY", "CLOUDFLARE_ACCOUNT_ID", "R2_BUCKET_NAME"],
    ],
  },
  { id: "malwareScanning", alternatives: [["SCAN_SERVICE"]], worker: "scan" },
  { id: "filePreview", alternatives: [["FILES_ORIGIN"]] },
  { id: "fileConversion", alternatives: [["CONVERT"]], worker: "convert" },
  { id: "textRecognition", alternatives: [["OCR_SERVICE"]], worker: "ocr" },
  { id: "documentEditing", alternatives: [["EDIT_SERVICE"]], worker: "edit" },
  { id: "documentSealing", alternatives: [["SIGN_SERVICE"]], worker: "sign" },
  { id: "archiveDownloads", alternatives: [["BUNDLE_SERVICE"]], worker: "bundle" },
  { id: "fileRepair", alternatives: [["FILE_REPAIR_SERVICE"]], worker: "fileRepair" },
  { id: "passwordRecovery", alternatives: [["RECOVERY_SERVICE"]], worker: "recovery" },
  { id: "discoveryProcessing", alternatives: [["DISCOVERY_SERVICE"]], worker: "discovery" },
  // Search and lookups
  { id: "fileContentsSearch", alternatives: [["SEARCH_SERVICE"]], worker: "search" },
  { id: "naturalLanguageSearch", alternatives: [["AI_SEARCH", "AI_SEARCH_NAMESPACES"]] },
  {
    id: "addressSuggestions",
    alternatives: [
      ["GOOGLE_PLACES_API_KEY"],
      ["ADDRESS_SERVICE"],
      ["SMARTY_AUTH_ID", "SMARTY_AUTH_TOKEN"],
    ],
    worker: "address",
  },
  // AI
  { id: "aiTextDetection", alternatives: [["PANGRAM_API_KEY"]] },
  { id: "modelAvailabilityCheck", alternatives: [["ANTHROPIC_MODELS_API_KEY"]] },
  // Platform
  { id: "signUpBotCheck", alternatives: [["TURNSTILE_SECRET_KEY"]] },
  { id: "communitySignIn", alternatives: [["COMMUNITY_HANDOFF_SECRET"]] },
  { id: "featureFlags", alternatives: [["FLAGS"]] },
  { id: "usageAnalytics", alternatives: [["TELEMETRY", "USAGE_ANALYTICS_PEPPER"]] },
  { id: "recentErrors", alternatives: [["CLOUDFLARE_ACCOUNT_ID", "OBSERVABILITY_API_TOKEN"]] },
] as const satisfies readonly FeatureDefinition[];

export type FeatureId = (typeof FEATURE_ROSTER)[number]["id"];
export const FEATURE_IDS = FEATURE_ROSTER.map((feature) => feature.id) as [
  FeatureId,
  ...FeatureId[],
];

export type FeatureState = "working" | "not-set-up" | "fault";

/** What the environment says about each name, and nothing about its value. */
export interface RequirementPresence {
  name: RequirementName;
  present: boolean;
  /**
   * Where a present secret's value came from: the account's Secrets Store, or this Worker's own
   * secret. Null for a name that is not a secret (a binding, a variable) or that is absent.
   */
  source: "secrets-store" | "worker" | null;
}

export interface FeatureStatusReport {
  readonly id: FeatureId;
  readonly state: FeatureState;
}

export interface FeatureRequirementsReport {
  id: FeatureId;
  alternatives: RequirementPresence[][];
}

/*
 * Present means configured: a binding object, or a string with something in it. An empty string is
 * how a dashboard variable that was cleared rather than deleted reads, and a feature built on it
 * behaves as though the value were missing, so it reads as missing here too.
 */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function presenceOf(
  environment: Partial<Record<RequirementName, unknown>>,
  alternatives: readonly (readonly RequirementName[])[],
): RequirementPresence[][] {
  const secretNames: readonly string[] = API_WORKER_SECRET_NAMES;
  const sources = secretSourcesOf(environment, secretNames);
  return alternatives.map((names) =>
    names.map((name) => {
      const present = isPresent(environment[name]);
      const source = sources[name];
      return {
        name,
        present,
        source:
          present && secretNames.includes(name)
            ? source === "secrets-store"
              ? "secrets-store"
              : "worker"
            : null,
      };
    }),
  );
}

/** The state of every feature, from the environment and the probes the versions read already ran. */
export function featureStatuses(
  environment: Partial<Record<RequirementName, unknown>>,
  probes: {
    readonly workers: ReadonlyMap<string, "reported" | "unbound" | "unreachable" | "unreported">;
    readonly connectedServices: ReadonlyMap<string, ConnectedServiceStatusReport["state"]>;
  },
): FeatureStatusReport[] {
  return FEATURE_ROSTER.map((feature: FeatureDefinition) => {
    const setUp = presenceOf(environment, feature.alternatives).some((alternative) =>
      alternative.every((requirement) => requirement.present),
    );
    const id = feature.id as FeatureId;
    if (!setUp) return { id, state: "not-set-up" };
    if (feature.connectedService !== undefined) {
      const state = probes.connectedServices.get(feature.connectedService);
      if (state === "refused" || state === "unreachable") return { id, state: "fault" };
      if (state === "not-configured") return { id, state: "not-set-up" };
    }
    // Address suggestions can be set up through Google or Smarty alone, so its Worker being unbound is not a
    // fault; only a Worker that is bound and silent is.
    if (feature.worker !== undefined && probes.workers.get(feature.worker) === "unreachable") {
      return { id, state: "fault" };
    }
    return { id, state: "working" };
  });
}

/** Which names each feature needs and which of them are present. For platform operators only. */
export function featureRequirements(
  environment: Partial<Record<RequirementName, unknown>>,
): FeatureRequirementsReport[] {
  return FEATURE_ROSTER.map((feature: FeatureDefinition) => ({
    id: feature.id as FeatureId,
    alternatives: presenceOf(environment, feature.alternatives),
  }));
}
