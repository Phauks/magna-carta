/*
 * The version overlay's pure model: the wire shape of GET /api/v1/meta/versions (hand-written,
 * mirroring apps/api-worker/openapi/openapi.json, like every surface's shapes — see
 * $lib/api/request.ts), and the small decisions the panel renders — when two builds count as
 * skewed, what each honest non-answer is called and what it actually means, how a cached
 * observation states its age, the one-line identifier a copy click puts on the clipboard, and the
 * deployed unit each row is reporting on (the Cloudflare Worker someone would open to act on it).
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

/** An elapsed span in words, from "a moment ago" up through minutes. */
function ageInWords(ageMilliseconds: number): string {
  if (ageMilliseconds < OBSERVATION_FRESH_MILLISECONDS) return "a moment ago";
  const ageSeconds = Math.round(ageMilliseconds / 1000);
  if (ageSeconds < 90) return `${String(ageSeconds)} seconds ago`;
  const ageMinutes = Math.round(ageSeconds / 60);
  return `${String(ageMinutes)} ${ageMinutes === 1 ? "minute" : "minutes"} ago`;
}

/**
 * How old the service observation is, in words — or null while it is fresh enough that an age
 * line would be noise. The API caches the aggregate briefly, so an open panel can be reading an
 * observation up to a minute old; past ten seconds the panel says so instead of implying "now".
 * A manual re-ask that lands inside that cache window gets the same observation back, and this
 * line is what keeps that honest: the age goes on climbing rather than resetting to "now".
 */
export function describeObservationAge(
  observedAtIso: string,
  nowEpochMilliseconds: number,
): string | null {
  const observedAtEpochMilliseconds = Date.parse(observedAtIso);
  if (Number.isNaN(observedAtEpochMilliseconds)) return null;
  const ageMilliseconds = nowEpochMilliseconds - observedAtEpochMilliseconds;
  if (ageMilliseconds < OBSERVATION_FRESH_MILLISECONDS) return null;
  return `checked ${ageInWords(ageMilliseconds)}`;
}

/**
 * What the rows still on screen are, once a re-ask has failed. The previous answer is kept rather
 * than blanked — it is the last true thing this panel knew — but it must stop reading as current,
 * so this states its age unconditionally, including inside the window where the header line above
 * stays quiet.
 */
export function describeRetainedRows(observedAtIso: string, nowEpochMilliseconds: number): string {
  const observedAtEpochMilliseconds = Date.parse(observedAtIso);
  if (Number.isNaN(observedAtEpochMilliseconds)) {
    return "The rows below are from the last read that answered, not from this one.";
  }
  const ageMilliseconds = nowEpochMilliseconds - observedAtEpochMilliseconds;
  return `The rows below are from the last read that answered, ${ageInWords(ageMilliseconds)}.`;
}

/** The header line while a read is in flight, so the re-ask is visible before its answer lands. */
export const READ_IN_FLIGHT_NOTICE = "Checking services";

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

/*
 * THE DEPLOYED UNIT EACH ROW REPORTS ON.
 *
 * A row labelled by what a service DOES ("Malware Scan") does not tell a reader which project to
 * open when it says "Not reporting". The identity does, so the identity leads and the description
 * follows it.
 *
 * Every name below is read off something that deploys it, never guessed:
 * - the eight service bindings in apps/api-worker/wrangler.jsonc (`services[].service`), which is
 *   the script name Cloudflare resolves the binding to;
 * - `magna-carta-search`, which docs/conventions/operations.md names as the project that will hold
 *   the search index Worker. It is not a connected project and `SEARCH_SERVICE` is not in the
 *   bindings array, so that row reads "Not deployed" and the name is what will exist, stated as
 *   the target rather than as a running thing.
 *
 * An id with no entry here keeps its description as the row heading rather than borrowing a name
 * from a neighbour: a service added to the API's roster and not to this map is unnamed, not
 * misnamed.
 */
const DEPLOYED_UNIT_NAMES: Readonly<Record<string, string>> = {
  scan: "magna-carta-scan",
  bundle: "magna-carta-bundle",
  convert: "magna-carta-convert",
  fileRepair: "magna-carta-file-repair",
  recovery: "magna-carta-recovery",
  ocr: "magna-carta-ocr",
  sign: "magna-carta-sign",
  discovery: "magna-carta-discovery",
  search: "magna-carta-search",
};

/** The Cloudflare Worker a service row reports on, or null when this build has no name for it. */
export function deployedUnitName(serviceId: string): string | null {
  return DEPLOYED_UNIT_NAMES[serviceId] ?? null;
}

/**
 * The Worker that serves both the API and this page. `apps/api-worker/wrangler.jsonc` declares
 * `assets: { directory: "../web/build" }`, so the SPA is bundled into this Worker's deployment
 * rather than deployed beside it.
 */
export const API_WORKER_UNIT_NAME = "magna-carta";

/** What the web row reports on: the bundle the browser is running right now. */
export const WEB_APP_ROW_DESCRIPTION = "Web app bundle this page loaded";

/** What the API row reports on: the Worker that answered the read a moment ago. */
export const API_ROW_DESCRIPTION = "API Worker answering now";

/**
 * The architectural fact the two rows above are otherwise silent about, and the one that cost the
 * owner a confused deploy watch: the SPA has its own Workers Builds project (`magna-carta-web`, an
 * assets-only second door to the same files), and that project going green changes nothing about
 * what this site serves. The bytes a visitor gets come from the API Worker's own assets, so they
 * change on the API Worker's deploy and on nothing else.
 */
export const WEB_APP_SHIPS_INSIDE_API_NOTICE =
  "The web app is bundled into the API Worker: a new bundle reaches this site when " +
  "magna-carta deploys, not when magna-carta-web builds.";

/**
 * What a difference between the two commits actually means. It is not two deployables that have
 * drifted apart, because there is only one: the bundle and the Worker ship together. So a
 * difference says the page in this tab was served by an earlier deployment than the one now
 * answering, and a reload is the whole fix.
 */
export const BUILD_SKEW_EXPLANATION =
  "This page and the API answering it come from different deployments of magna-carta. Reload to " +
  "take the newer bundle.";

/** The line under the Services heading when the deployment is wired to no service at all. */
export const NO_SERVICES_NOTICE = "This deployment is not wired to any backend service.";

/** Joins a row's detail segments, dropping the ones that were not known. */
export function joinDetailSegments(segments: readonly (string | null)[]): string | null {
  const present = segments.filter((segment): segment is string => segment !== null);
  return present.length === 0 ? null : present.join(" · ");
}
