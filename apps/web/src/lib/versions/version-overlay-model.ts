/*
 * The version overlay's pure model: the wire shape of GET /api/v1/meta/versions (hand-written,
 * mirroring apps/api-worker/openapi/openapi.json, like every surface's shapes — see
 * $lib/api/request.ts), and the small decisions the panel renders — what each honest non-answer
 * is called and what it actually means, how a cached
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
  /** The Cloudflare Worker the row reports on — the name someone would open in the dashboard. */
  service: string;
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

/*
 * DELIBERATELY ABSENT: a page-versus-API "different builds" warning. The panel carried one while
 * the bundle shipped inside the API Worker, when a difference meant this tab predated the one
 * deployment there was. Since the interface moved onto its own Worker (magna-carta-web, serving
 * the app's address by route pattern), the page and the API deploy separately and their commits
 * differ whenever one has shipped more recently than the other — a normal state, not an anomaly,
 * and a standing warning about a normal state teaches people to ignore warnings. The reload signal
 * is the version poll (UPDATE_AVAILABLE_EXPLANATION below), which compares this tab against the
 * deployment that actually serves it. The rows still show every commit; the reader who needs the
 * comparison has it, without an alarm attached.
 */

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
 * line would be noise. The API caches the aggregate briefly, so a panel opened inside that window
 * can be reading an observation up to a minute old; past ten seconds the panel says so instead of
 * implying "now". A manual Refresh asks for a fresh probe (fresh=true skips the cache), so its
 * answer starts this clock over — the line exists for the cached automatic reads.
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
 * NAMING RULE: every deployment row is headed by the Cloudflare Worker it reports on — the name
 * someone would open in the dashboard — and by nothing else. The names arrive from the API's own
 * roster (each row's `service` field), which reads them off the wrangler configs that deploy them,
 * so this file no longer keeps a map of its own and no row carries an invented product name. The
 * one row that is not a Worker is the build line: the bundle this browser is running, named for
 * what it is rather than for the Worker that happened to serve it.
 */

/**
 * The Worker that serves the API. It also still bundles a copy of the SPA build as static assets —
 * the local-dev vehicle (`wrangler dev` serves the whole app from it) and the routing fallback —
 * but on the deployed site the interface is served by `magna-carta-web` (see the notice below).
 */
export const API_WORKER_UNIT_NAME = "magna-carta";

/**
 * The build line's name. The old panel headed this row "magna-carta", which was the Worker that
 * SERVED the bundle, not the thing the row reports on — the bundle the browser is running right
 * now, which can outlive the deployment that served it by however long the tab stays open.
 */
export const PAGE_BUILD_ROW_NAME = "This page";

/**
 * The topology in one line, where a reader comparing the rows will look for it. The app's address
 * is split by route pattern: magna-carta-web serves the interface, magna-carta answers the API.
 * They deploy separately, which is why their commits are allowed to differ without a warning.
 */
export const WEB_TOPOLOGY_NOTICE =
  "This page is served by magna-carta-web and the API answers from magna-carta. The two deploy " +
  "separately, so their versions can differ.";

/**
 * The deployment list's order: the two Workers that serve the app's address lead — magna-carta
 * (the API, rendered from the aggregate's own `api` object) and then magna-carta-web (the Worker
 * this page came from) — and the rest of the fleet sits beneath a separator. The pair is what a
 * reader comparing against the "This page" line needs first; the fleet below is reference. Keyed
 * by the wire's own id so a rename of the Worker cannot silently demote it.
 */
export function partitionDeploymentRows(services: readonly ServiceVersionRow[]): {
  front: ServiceVersionRow[];
  rest: ServiceVersionRow[];
} {
  return {
    front: services.filter((row) => row.id === "web"),
    rest: services.filter((row) => row.id !== "web"),
  };
}

/**
 * The line the update poller earns, and it has a direction: the app's own version poll saw a
 * bundle newer than the one this tab loaded, so a reload moves forward.
 */
export const UPDATE_AVAILABLE_EXPLANATION = "A newer deployment is live. Reload to pick it up.";

/** The Reload control's one label. */
export const RELOAD_ACTION_LABEL = "Reload";

/** The line under the Deployment heading when the read reports no sibling worker at all. */
export const NO_SERVICES_NOTICE = "This deployment reports no sibling worker.";
