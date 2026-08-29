/*
 * The version overlay's pure model: the wire shape of GET /api/v1/meta/versions (hand-written,
 * mirroring apps/api-worker/openapi/openapi.json, like every surface's shapes — see
 * $lib/api/request.ts), and the small decisions the panel renders — when two builds count as
 * skewed, what each honest non-answer is called, how a cached observation states its age, and the
 * one-line identifier a copy click puts on the clipboard. Kept free of Svelte and of the vite
 * define constants so the node-pool tests exercise every rule directly.
 */

export type ServiceVersionState = "reported" | "unbound" | "unreachable" | "unreported";

export interface ServiceVersionRow {
  id: string;
  label: string;
  state: ServiceVersionState;
  commit: string | null;
  commitTime: string | null;
  buildTime: string | null;
}

export interface MetaVersionsValue {
  api: { commit: string; commitTime: string | null; buildTime: string | null };
  services: ServiceVersionRow[];
  observedAt: string;
}

/**
 * True when the commit is a real build stamp rather than one of the honest placeholders ("dev"
 * from a worker built without git identity, "unknown" from a web build outside the package dir).
 */
export function isRealCommit(commit: string | null): commit is string {
  return commit !== null && commit !== "" && commit !== "dev" && commit !== "unknown";
}

/**
 * The chip's text: the real short commit, or "dev" when this build has no stamped identity. Never
 * empty — the chip is always visible, so its honest fallback is a word, not a blank.
 */
export function versionChipLabel(commit: string): string {
  return isRealCommit(commit) ? commit : "dev";
}

/**
 * Whether the web app and the API are visibly running different builds. Only two REAL commits can
 * disagree: a dev placeholder on either side says "no identity", not "a different identity", and
 * claiming a skew from it would be a false alarm on every local run.
 */
export function buildsDiffer(webCommit: string, apiCommit: string | null): boolean {
  return isRealCommit(webCommit) && isRealCommit(apiCommit) && webCommit !== apiCommit;
}

/** The honest label for a service that could not report a version. Reported rows carry none. */
export function serviceStateLabel(state: ServiceVersionState): string | null {
  switch (state) {
    case "reported":
      return null;
    case "unbound":
      return "Not deployed";
    case "unreachable":
      return "Unreachable";
    case "unreported":
      return "Not reporting";
  }
}

const OBSERVATION_FRESH_MILLISECONDS = 10_000;

/**
 * How old the service observation is, in words — or null while it is fresh enough that an age
 * line would be noise. The API caches the aggregate briefly, so an open panel can be reading an
 * observation up to a minute old; past ten seconds the panel says so instead of implying "now".
 */
export function describeObservationAge(
  observedAtIso: string,
  nowEpochMilliseconds: number,
): string | null {
  const observedAtEpochMilliseconds = Date.parse(observedAtIso);
  if (Number.isNaN(observedAtEpochMilliseconds)) return null;
  const ageMilliseconds = nowEpochMilliseconds - observedAtEpochMilliseconds;
  if (ageMilliseconds < OBSERVATION_FRESH_MILLISECONDS) return null;
  const ageSeconds = Math.round(ageMilliseconds / 1000);
  if (ageSeconds < 90) return `checked ${String(ageSeconds)} seconds ago`;
  const ageMinutes = Math.round(ageSeconds / 60);
  return `checked ${String(ageMinutes)} ${ageMinutes === 1 ? "minute" : "minutes"} ago`;
}

/**
 * The line a copy click puts on the clipboard: part name, commit, and the two timestamps that
 * were actually known — a paste into a bug report stays honest about what was not.
 */
export function copyLineForPart(part: {
  label: string;
  commit: string;
  commitTime: string | null;
  buildTime: string | null;
}): string {
  const segments = [`${part.label}: ${part.commit}`];
  if (part.commitTime !== null) segments.push(`committed ${part.commitTime}`);
  if (part.buildTime !== null) segments.push(`built ${part.buildTime}`);
  return segments.join(" · ");
}

/** A compact local rendering of an ISO timestamp for the panel's meta lines; null passes through. */
export function formatVersionTimestamp(iso: string | null): string | null {
  if (iso === null) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
