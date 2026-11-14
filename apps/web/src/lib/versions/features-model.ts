/*
 * The features the deployment can switch on, as System Status shows them: what each is called,
 * which group it sits in, what its state means, and — for a platform operator — the steps that
 * turn it on and the deploy-queue section that holds the full version.
 *
 * The API owns the roster and decides each state (apps/api-worker/src/system-status/
 * feature-roster.ts); this file owns the words. A feature id the API sends that this file does not
 * know is shown under its id rather than dropped, so a feature added on the API side before its
 * words land here is still visible; test/system-status-features.test.ts reads the API roster and
 * fails until every id has words here.
 *
 * Pure, like the panel's other models, so the words are testable without a browser.
 */
import type { HealthReading } from "./database-health-model.ts";
import { countPill, type SectionPill } from "./version-overlay-model.ts";

export type FeatureState = "working" | "not-set-up" | "fault";

export interface FeatureStatus {
  readonly id: string;
  readonly state: FeatureState;
}

export interface RequirementPresence {
  readonly name: string;
  readonly present: boolean;
  /**
   * Where a present secret came from: the account's Secrets Store or the Worker's own secret. Null
   * for a binding or a plain setting, and for anything absent. Optional so an older API's answer,
   * which had no source, still reads.
   */
  readonly source?: "secrets-store" | "worker" | null;
}

export interface FeatureRequirements {
  readonly id: string;
  /** The feature is set up when every name in at least one alternative is present. */
  readonly alternatives: readonly (readonly RequirementPresence[])[];
}

/** The heading over the features, which is also its tab's and its fold's label. */
export const FEATURES_SECTION_LABEL = "Features";

export type FeatureGroupId =
  | "meetings"
  | "calendarAndEmail"
  | "files"
  | "search"
  | "ai"
  | "platform";

export const FEATURE_GROUPS: readonly { id: FeatureGroupId; label: string }[] = [
  { id: "meetings", label: "Meetings and Calls" },
  { id: "calendarAndEmail", label: "Calendar and Email" },
  { id: "files", label: "Files and Documents" },
  { id: "search", label: "Search and Lookups" },
  { id: "ai", label: "AI" },
  { id: "platform", label: "Platform" },
];

interface FeatureWords {
  readonly name: string;
  readonly group: FeatureGroupId;
  /** The short version of what turns it on. The deploy queue holds the long one. */
  readonly steps: readonly string[];
  /** The `##` heading in docs/deploy-queue.md that covers it, exactly as written, or null. */
  readonly deployQueueHeading: string | null;
}

const MEETINGS_HEADING =
  "Meetings — what the account needs before video meetings and recording work (added 2026-10-02)";

/** Words for the worker-backed features: deploy the Worker, then bind it. */
function workerSteps(worker: string, binding: string): string[] {
  return [
    `Deploy the ${worker} Worker (connect it to Workers Builds on the main branch).`,
    `Bind it to the magna-carta Worker as ${binding} in apps/api-worker/wrangler.jsonc, and merge.`,
  ];
}

export const FEATURE_WORDS: Record<string, FeatureWords> = {
  meetings: {
    name: "Meetings",
    group: "meetings",
    steps: [
      "Create a Cloudflare Realtime SFU application.",
      "On the magna-carta Worker, set the secrets REALTIME_SFU_APP_ID and REALTIME_SFU_APP_SECRET.",
    ],
    deployQueueHeading: MEETINGS_HEADING,
  },
  meetingRecording: {
    name: "Meeting recording",
    group: "meetings",
    steps: [
      "Prove the Realtime WebSocket adapter keeps the sink address intact.",
      "Set the secret MEETING_SINK_SIGNING_KEY and create the two recording compose queues.",
      "Bind MEETING_RECORDER and MEETING_RECORDING_COMPOSE on the magna-carta Worker.",
    ],
    deployQueueHeading: MEETINGS_HEADING,
  },
  networkPacketLoss: {
    name: "Packet loss in Network Speed Test",
    group: "meetings",
    steps: [
      "Create a Cloudflare Realtime TURN key.",
      "On the magna-carta Worker, set the secrets REALTIME_TURN_TOKEN_ID and REALTIME_TURN_TOKEN_SECRET.",
    ],
    deployQueueHeading: null,
  },
  callerLookup: {
    name: "Caller ID lookup",
    group: "meetings",
    steps: ["On the magna-carta Worker, set the secret TELNYX_API_KEY. Each lookup is billed."],
    deployQueueHeading: null,
  },
  outlookCalendarSync: {
    name: "Outlook calendar sync",
    group: "calendarAndEmail",
    steps: [
      "Register one application in Microsoft Entra, with the redirect address https://magnacarta.esq/api/v1/integrations/microsoft/callback.",
      "On the magna-carta Worker, set MICROSOFT_CLIENT_ID and the secret MICROSOFT_CLIENT_SECRET (and MICROSOFT_TENANT for one tenant).",
    ],
    deployQueueHeading:
      "Outlook calendar connection activation — register one Microsoft application, then two secrets (2026-11-10)",
  },
  googleCalendarSync: {
    name: "Google Calendar sync",
    group: "calendarAndEmail",
    steps: [
      "Create one OAuth client in a Google Cloud project, with the redirect address https://magnacarta.esq/api/v1/integrations/google/callback.",
      "On the magna-carta Worker, set GOOGLE_CALENDAR_CLIENT_ID and the secret GOOGLE_CALENDAR_CLIENT_SECRET.",
    ],
    deployQueueHeading:
      "Google Calendar connection activation: one Google Cloud project, then two secrets (2026-11-13)",
  },
  outgoingEmail: {
    name: "Outgoing email",
    group: "calendarAndEmail",
    steps: [
      "Onboard the sending domain in Cloudflare Email Service.",
      "Bind SEND_EMAIL and set EMAIL_FROM on the magna-carta Worker.",
    ],
    deployQueueHeading: null,
  },
  notificationDigest: {
    name: "Notification email digest",
    group: "calendarAndEmail",
    steps: ["Set up outgoing email first.", "Set APP_BASE_URL on the magna-carta Worker."],
    deployQueueHeading:
      "Notification digest activation — three values, in this order, and nothing is mailed until all three exist",
  },
  emailCapture: {
    name: "Email capture",
    group: "calendarAndEmail",
    steps: workerSteps("magna-carta-email", "EMAIL_SERVICE"),
    deployQueueHeading: "Email capture activation (after the mint route ships)",
  },
  directUpload: {
    name: "Direct upload to storage",
    group: "files",
    steps: [
      "Create an R2 S3 API token for the account.",
      "On the magna-carta Worker, set R2_S3_ACCESS_KEY_ID, R2_S3_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID and R2_BUCKET_NAME.",
    ],
    deployQueueHeading: null,
  },
  malwareScanning: {
    name: "Malware scanning",
    group: "files",
    steps: workerSteps("magna-carta-scan", "SCAN_SERVICE"),
    deployQueueHeading: null,
  },
  filePreview: {
    name: "File preview and video streaming",
    group: "files",
    steps: [
      "Attach the files host to the zone with a route to the magna-carta Worker.",
      "Set FILES_ORIGIN to that host in apps/api-worker/wrangler.jsonc, and merge.",
    ],
    deployQueueHeading: null,
  },
  fileConversion: {
    name: "File conversion",
    group: "files",
    steps: workerSteps("magna-carta-convert", "CONVERT"),
    deployQueueHeading:
      "LibreOffice conversion engine activation — the deploy happened; one bucket rule turns out to be missing",
  },
  textRecognition: {
    name: "Text recognition (OCR)",
    group: "files",
    steps: workerSteps("magna-carta-ocr", "OCR_SERVICE"),
    deployQueueHeading: null,
  },
  documentEditing: {
    name: "Document editing",
    group: "files",
    steps: workerSteps("magna-carta-edit", "EDIT_SERVICE"),
    deployQueueHeading:
      "`magna-carta-edit` — deployed 2026-08-21; the screen it gated should now fill",
  },
  documentSealing: {
    name: "Document sealing",
    group: "files",
    steps: workerSteps("magna-carta-sign", "SIGN_SERVICE"),
    deployQueueHeading: null,
  },
  archiveDownloads: {
    name: "Large downloads",
    group: "files",
    steps: workerSteps("magna-carta-bundle", "BUNDLE_SERVICE"),
    deployQueueHeading: null,
  },
  fileRepair: {
    name: "File repair",
    group: "files",
    steps: workerSteps("magna-carta-file-repair", "FILE_REPAIR_SERVICE"),
    deployQueueHeading: null,
  },
  passwordRecovery: {
    name: "Password recovery for locked files",
    group: "files",
    steps: workerSteps("magna-carta-recovery", "RECOVERY_SERVICE"),
    deployQueueHeading: null,
  },
  discoveryProcessing: {
    name: "Discovery processing",
    group: "files",
    steps: workerSteps("magna-carta-discovery", "DISCOVERY_SERVICE"),
    deployQueueHeading: "Discovery processing lane — done end to end (API-confirmed 2026-08-24)",
  },
  fileContentsSearch: {
    name: "File contents search",
    group: "search",
    steps: workerSteps("magna-carta-search", "SEARCH_SERVICE"),
    deployQueueHeading:
      "Search engine activation — a new worker, a new container image, one binding",
  },
  naturalLanguageSearch: {
    name: "Natural-language search",
    group: "search",
    steps: ["Bind AI_SEARCH and AI_SEARCH_NAMESPACES on the magna-carta Worker."],
    deployQueueHeading: null,
  },
  addressSuggestions: {
    name: "Address suggestions",
    group: "search",
    steps: [
      "Either deploy the magna-carta-address Worker and bind it as ADDRESS_SERVICE,",
      "or set the secrets SMARTY_AUTH_ID and SMARTY_AUTH_TOKEN on the magna-carta Worker.",
    ],
    deployQueueHeading:
      "Address engine activation — a bucket, a new worker, one binding (2026-10-02)",
  },
  aiTextDetection: {
    name: "AI-text detection",
    group: "ai",
    steps: ["On the magna-carta Worker, set the secret PANGRAM_API_KEY, once a firm has asked."],
    deployQueueHeading: null,
  },
  modelAvailabilityCheck: {
    name: "AI model availability check",
    group: "ai",
    steps: [
      "Create a read-only Anthropic API key.",
      "On the magna-carta Worker, set it as the secret ANTHROPIC_MODELS_API_KEY.",
    ],
    deployQueueHeading: null,
  },
  signUpBotCheck: {
    name: "Sign-up bot check",
    group: "platform",
    steps: [
      "Create the Turnstile widget first.",
      "Then, on the magna-carta Worker, set the secret TURNSTILE_SECRET_KEY.",
    ],
    deployQueueHeading:
      "Turnstile activation — the order matters, and the widget comes before the secret",
  },
  communitySignIn: {
    name: "Community board sign-in",
    group: "platform",
    steps: [
      "Set the same secret COMMUNITY_HANDOFF_SECRET on the magna-carta and magna-carta-community Workers.",
    ],
    deployQueueHeading: null,
  },
  featureFlags: {
    name: "Feature flags",
    group: "platform",
    steps: ["Bind the Flagship binding FLAGS on the magna-carta Worker."],
    deployQueueHeading: null,
  },
  usageAnalytics: {
    name: "Usage analytics",
    group: "platform",
    steps: [
      "Bind the Analytics Engine dataset TELEMETRY.",
      "Set the secret USAGE_ANALYTICS_PEPPER on the magna-carta Worker.",
    ],
    deployQueueHeading: null,
  },
  recentErrors: {
    name: "Recent errors",
    group: "platform",
    steps: [
      "Create a Cloudflare API token with only Account > Workers Observability > Read.",
      "On the magna-carta Worker, set it as the secret OBSERVABILITY_API_TOKEN (CLOUDFLARE_ACCOUNT_ID is already set in production).",
    ],
    deployQueueHeading: "System Status recent errors — one read-only token (2026-11-13)",
  },
};

/*
 * The fleet Worker behind each Worker-backed feature: where a feature that is set up and not
 * answering is looked into. Mirrors the `worker` field of the API roster, by deployed name.
 */
export const FEATURE_WORKERS: Record<string, string> = {
  emailCapture: "magna-carta-email",
  malwareScanning: "magna-carta-scan",
  fileConversion: "magna-carta-convert",
  textRecognition: "magna-carta-ocr",
  documentEditing: "magna-carta-edit",
  documentSealing: "magna-carta-sign",
  archiveDownloads: "magna-carta-bundle",
  fileRepair: "magna-carta-file-repair",
  passwordRecovery: "magna-carta-recovery",
  discoveryProcessing: "magna-carta-discovery",
  fileContentsSearch: "magna-carta-search",
  addressSuggestions: "magna-carta-address",
};

export function featureSteps(id: string): readonly string[] {
  return FEATURE_WORDS[id]?.steps ?? [];
}

export function featureName(id: string): string {
  return FEATURE_WORDS[id]?.name ?? id;
}

export function featureGroup(id: string): FeatureGroupId {
  return FEATURE_WORDS[id]?.group ?? "platform";
}

const STATE_WORDS: Record<FeatureState, { status: string; reading: HealthReading }> = {
  working: { status: "Working", reading: "healthy" },
  "not-set-up": { status: "Not set up", reading: "attention" },
  fault: { status: "Not working", reading: "fault" },
};

/** What a member sees for a feature in the header panel: plainer, and nothing about setup. */
const MEMBER_STATE_WORDS: Record<FeatureState, string> = {
  working: "Working",
  "not-set-up": "Not available yet",
  fault: "Not working",
};

export function featureStateLabel(state: FeatureState): string {
  return STATE_WORDS[state].status;
}

export function featureMemberStateLabel(state: FeatureState): string {
  return MEMBER_STATE_WORDS[state];
}

export function featureStateReading(state: FeatureState): HealthReading {
  return STATE_WORDS[state].reading;
}

/** The order a feature list reads in: what is broken, then what is off, then what works. */
const STATE_ORDER: Record<FeatureState, number> = { fault: 0, "not-set-up": 1, working: 2 };

export function sortFeatures<Feature extends FeatureStatus>(
  features: readonly Feature[],
): Feature[] {
  return [...features].sort((left, right) => STATE_ORDER[left.state] - STATE_ORDER[right.state]);
}

export interface FeatureCounts {
  readonly total: number;
  readonly working: number;
  readonly notSetUp: number;
  readonly fault: number;
}

export function countFeatures(features: readonly FeatureStatus[]): FeatureCounts {
  return {
    total: features.length,
    working: features.filter((feature) => feature.state === "working").length,
    notSetUp: features.filter((feature) => feature.state === "not-set-up").length,
    fault: features.filter((feature) => feature.state === "fault").length,
  };
}

/** The pills a feature group's heading wears: its size, and anything not working. */
export function featureSectionPills(features: readonly FeatureStatus[]): SectionPill[] {
  const counts = countFeatures(features);
  const pills: SectionPill[] = [countPill(counts.total, "feature")];
  if (counts.fault > 0) {
    pills.push({ label: `${String(counts.fault)} not working`, variant: "danger" });
  }
  if (counts.notSetUp > 0) {
    pills.push({ label: `${String(counts.notSetUp)} not set up`, variant: "neutral" });
  }
  return pills;
}

/** The features grouped for the page, groups in their fixed order, empty groups dropped. */
export function groupFeatures<Feature extends FeatureStatus>(
  features: readonly Feature[],
): { id: FeatureGroupId; label: string; features: Feature[] }[] {
  return FEATURE_GROUPS.map((group) => ({
    ...group,
    features: sortFeatures(features.filter((feature) => featureGroup(feature.id) === group.id)),
  })).filter((group) => group.features.length > 0);
}

/** The settings still missing, from the alternative closest to complete. */
export function missingRequirements(requirements: FeatureRequirements | undefined): string[] {
  if (requirements === undefined || requirements.alternatives.length === 0) return [];
  const missingPerAlternative = requirements.alternatives.map((alternative) =>
    alternative
      .filter((requirement) => !requirement.present)
      .map((requirement) => requirement.name),
  );
  return missingPerAlternative.reduce((closest, candidate) =>
    candidate.length < closest.length ? candidate : closest,
  );
}

/**
 * Where the secrets of a set-up feature come from, read off the first alternative that is complete
 * (the one the feature is running on). Names with no secret source, such as a binding, are left out.
 */
export function secretSources(requirements: FeatureRequirements | undefined): {
  store: string[];
  worker: string[];
} {
  const complete = requirements?.alternatives.find((alternative) =>
    alternative.every((requirement) => requirement.present),
  );
  const named = (source: "secrets-store" | "worker"): string[] =>
    (complete ?? [])
      .filter((requirement) => requirement.source === source)
      .map((requirement) => requirement.name);
  return { store: named("secrets-store"), worker: named("worker") };
}

/** One line saying where a feature's secrets come from, or null when it reads none. */
export function describeSecretSources(
  requirements: FeatureRequirements | undefined,
): string | null {
  const { store, worker } = secretSources(requirements);
  const parts = [
    ...(store.length > 0 ? [`From the Secrets Store: ${store.join(", ")}`] : []),
    ...(worker.length > 0 ? [`On the Worker: ${worker.join(", ")}`] : []),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
}

/*
 * GitHub's anchor for a markdown heading: lower-cased, every character that is not a letter, a
 * digit, a space, a hyphen or an underscore removed, and each space turned into a hyphen. Removing
 * an em dash leaves its two spaces, which is why "Meetings — what" anchors as "meetings--what".
 */
export function githubHeadingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Where a feature's full setup steps are, or null when the deploy queue has no section for it. */
export function deployQueueUrl(repository: string | null, id: string): string | null {
  const heading = FEATURE_WORDS[id]?.deployQueueHeading ?? null;
  if (repository === null || heading === null) return null;
  return `${repository}/blob/main/docs/deploy-queue.md#${githubHeadingAnchor(heading)}`;
}

/** One line per feature for the copied report. */
export function copyLineForFeature(feature: FeatureStatus): string {
  return `${featureName(feature.id)}: ${featureStateLabel(feature.state)}`;
}
