/*
 * The version overlay's pure model: the wire shape of GET /api/v1/meta/versions (hand-written,
 * mirroring apps/api-worker/openapi/openapi.json, like every surface's shapes — see
 * $lib/api/request.ts), and the small decisions the panel renders — when two builds count as
 * skewed, what each honest non-answer is called and what it actually means, how a cached
 * observation states its age, and the one-line identifier a copy click puts on the clipboard.
 * Kept free of Svelte and of the vite define constants so the node-pool tests exercise every rule
 * directly.
 */

export type ServiceVersionState = "reported" | "unbound" | "unreachable" | "unreported";

/**
 * Where the chip is rendered, which decides what it is allowed to read.
 *
 * - `app` — inside a session. The panel reads the aggregate and reports the whole deployment.
 * - `public` — a signed-out surface (sign in, password reset, the joining screens). The web app's
 *   own build is already inside the bundle the visitor downloaded, so showing it discloses
 *   nothing new; the aggregate is an authenticated read and is not attempted here.
 */
export type VersionScope = "app" | "public";

/**
 * Whether a chip in this scope may read GET /api/v1/meta/versions. Only the signed-in scope may:
 * the endpoint is authenticated, so calling it from a signed-out page can only ever produce a
 * rejection, and rendering that rejection would report a fault where the real answer is "not
 * yours to see yet".
 */
export function readsServiceAggregate(scope: VersionScope): boolean {
  return scope === "app";
}

/**
 * The one line a signed-out panel shows in place of the estate it may not read. It states the
 * boundary rather than implying a failure, so nobody chases an outage that is a session boundary.
 */
export const SIGNED_OUT_ESTATE_NOTICE =
  "The API and the backend services report their versions once you are signed in.";

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
 * The shortest abbreviation two commit stamps must agree on before they are read as the same
 * commit. Git's own rule: one abbreviation of a hash is a prefix of any longer one, and seven hex
 * characters is the floor below which a shared prefix stops meaning anything.
 */
const SHORTEST_COMPARABLE_COMMIT_LENGTH = 7;

/**
 * Whether two real commit stamps name the same commit. They are compared by prefix rather than by
 * equality because the two sides abbreviate independently: the web app's stamp comes from git in
 * its own build, and a Worker built where git was unavailable stamps itself from the build
 * runner's commit variable instead. Same commit, possibly different number of characters, and an
 * equality test would call that a skew and raise a warning about a deployment that is in step.
 */
function commitsAgree(left: string, right: string): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < SHORTEST_COMPARABLE_COMMIT_LENGTH) return false;
  return longer.toLowerCase().startsWith(shorter.toLowerCase());
}

/**
 * Whether the web app and the API are visibly running different builds. Only two REAL commits can
 * disagree: a dev placeholder on either side says "no identity", not "a different identity", and
 * claiming a skew from it would be a false alarm on every local run.
 */
export function buildsDiffer(webCommit: string, apiCommit: string | null): boolean {
  return isRealCommit(webCommit) && isRealCommit(apiCommit) && !commitsAgree(webCommit, apiCommit);
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

/**
 * The sentence that makes a two-word badge mean something. The three non-answers are three
 * different facts about the deployment, and the labels alone do not separate them: "Not deployed"
 * is a service this deployment was never wired to, "Unreachable" is a wired service that failed
 * the read, and "Not reporting" is a healthy service running a build made before it could answer
 * the question. Read as a bare badge, all three look like the same outage, and the last one is not
 * an outage at all. Reported rows carry no sentence: their commit says everything.
 */
export function serviceStateDescription(state: ServiceVersionState): string | null {
  switch (state) {
    case "reported":
      return null;
    case "unbound":
      return "This deployment is not wired to it.";
    case "unreachable":
      return "Wired here, but it did not answer.";
    case "unreported":
      return "Answering, from a build too old to state its version.";
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
