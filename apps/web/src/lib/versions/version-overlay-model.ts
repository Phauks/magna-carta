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

/**
 * Whether the two Workers that serve the app's address — `magna-carta-web` and `magna-carta` — are
 * running the same build, and if not, which side is behind. Comparable only when both sides carry
 * a real commit: a dev build or a web row that has not reported (unbound/unreachable/unreported)
 * gives no basis for a comparison, so the panel shows no indicator then rather than guessing.
 */
export type ApiWebSyncState = "in-sync" | "web-behind" | "mismatch";

/**
 * Compares the API's own commit against the `magna-carta-web` row. "web-behind" only when the
 * commit times say so directly — a build time earlier than the API's — so an unresolvable order
 * (a missing timestamp, or the API the one that is behind) falls into the calmer "mismatch" bucket
 * rather than a claim this function cannot back up.
 */
export function apiWebSyncState(
  api: { commit: string; commitTime: string | null },
  web: ServiceVersionRow | null,
): ApiWebSyncState | null {
  if (!isRealCommit(api.commit)) return null;
  if (web === null || web.state !== "reported" || !isRealCommit(web.commit)) return null;
  if (web.commit === api.commit) return "in-sync";
  if (web.commitTime === null || api.commitTime === null) return "mismatch";
  const webTime = Date.parse(web.commitTime);
  const apiTime = Date.parse(api.commitTime);
  if (Number.isNaN(webTime) || Number.isNaN(apiTime)) return "mismatch";
  return webTime < apiTime ? "web-behind" : "mismatch";
}

/**
 * The badge colour for each sync state. Calm, not alarmed: the two Workers deploy separately, so
 * differing is a normal state the reader should be able to see at a glance, not a fault — "warning"
 * is reserved for the one case that is actually actionable, `magna-carta-web` running behind the
 * API it serves.
 */
export function syncStateBadgeVariant(state: ApiWebSyncState): "success" | "warning" | "neutral" {
  switch (state) {
    case "in-sync":
      return "success";
    case "web-behind":
      return "warning";
    case "mismatch":
      return "neutral";
  }
}

/** The badge's text for each sync state. */
export function syncStateLabel(state: ApiWebSyncState): string {
  switch (state) {
    case "in-sync":
      return "In sync";
    case "web-behind":
      return "Web behind";
    case "mismatch":
      return "Different builds";
  }
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
 * The build line's name. It heads the bundle the browser is running, never the Worker that served
 * it — the two are different things, and the tab can outlive the deployment by however long it
 * stays open.
 */
export const PAGE_BUILD_ROW_NAME = "This page";

/** The wire id of the row for the Worker that serves the interface. */
export const WEB_WORKER_ROW_ID = "web";

/** The `magna-carta-web` row out of an aggregate's services, or null when the read has none. */
export function findWebWorkerRow(services: readonly ServiceVersionRow[]): ServiceVersionRow | null {
  return services.find((row) => row.id === WEB_WORKER_ROW_ID) ?? null;
}

/** Where the aggregate read has got to, which decides what the panel can lean on. */
export type VersionReadPhase = "pending" | "answered" | "failed";

/**
 * Whether the panel still owes a line for this bundle's own build.
 *
 * Owner ruling, 2026-08-31 (docs/conventions/design-corrections.md): the standing "This page" row
 * duplicated magna-carta-web. That Worker serves the interface, so whenever it reports, its commit
 * and timestamps ARE this page's, said once under the name someone can act on. The divergence the
 * row used to cover, a tab left open across a deploy, is already carried and carried better by the
 * update signal on the chip and the reload control beside it.
 *
 * So the line survives only where nothing else states this build: a signed-out panel (no aggregate
 * to read), a read that failed, and a web row that came back silent. Dropping it unconditionally
 * would leave those panels reporting no version at all, which is the opposite of the point. While
 * a first read is still in flight it stays away: the skeletons hold that space, and a row that
 * appears for a moment and then vanishes reads as a glitch rather than as an answer.
 */
export function showsPageBuildRow(panel: {
  readsAggregate: boolean;
  read: VersionReadPhase;
  webRow: ServiceVersionRow | null;
}): boolean {
  if (!panel.readsAggregate) return true;
  if (panel.read === "pending") return false;
  return panel.webRow === null || panel.webRow.state !== "reported";
}

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
    front: services.filter((row) => row.id === WEB_WORKER_ROW_ID),
    rest: services.filter((row) => row.id !== WEB_WORKER_ROW_ID),
  };
}

/**
 * The heading over the rest of the fleet — the Workers beneath the pair that serves the app's
 * address. It heads a collapsible section, so it is also the toggle's visible label.
 */
export const FLEET_SECTION_LABEL = "Workers";

/**
 * What a collapsed fleet must still say out loud. Every sibling Worker is listed, the silent ones
 * included, because a list that quietly omits them reads as "everything is healthy" — and folding
 * the section away would do exactly that omission by another route. So a collapsed heading carries
 * the count of rows that came back without a version, which is the one fact all three non-answers
 * share; a fleet that is entirely reporting carries nothing, and the collapse is free.
 */
export function summarizeSilentWorkers(rows: readonly ServiceVersionRow[]): string | null {
  const silent = rows.filter((row) => row.state !== "reported").length;
  if (silent === 0) return null;
  return `${String(silent)} without a version`;
}

/**
 * The line the update poller earns, and it has a direction: the app's own version poll saw a
 * bundle newer than the one this tab loaded, so a reload moves forward.
 */
export const UPDATE_AVAILABLE_EXPLANATION = "A newer deployment is live. Reload to pick it up.";

/** The Reload control's one label. It heads an icon control, so it is the accessible name too. */
export const RELOAD_ACTION_LABEL = "Reload";

/** The line under the Deployment heading when the read reports no sibling worker at all. */
export const NO_SERVICES_NOTICE = "This deployment reports no sibling worker.";
