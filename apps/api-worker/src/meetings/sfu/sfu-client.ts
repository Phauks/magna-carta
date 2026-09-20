import type { Bindings } from "../../app.ts";

// The client for Cloudflare Realtime's selective forwarding unit — the service that routes a
// meeting's audio, video and screen-share tracks between browsers.
//
// IT WRAPS THAT HTTPS API AND NOTHING ELSE. There is no retry, no cache, no fallback and no policy
// here: every decision about what to publish, what to subscribe to and what a participant is told
// belongs to the room, which is the only caller. What this module owns is the two things a caller
// must not be trusted with — the application credentials, and the assumption that an upstream body
// is the shape it claims to be.
//
// THE CREDENTIALS NEVER LEAVE THIS WORKER. A browser is handed session ids and session descriptions;
// it never holds the application secret, and it reaches the routing service only through the
// signaling room. That is also why a failure here is deliberately opaque: the upstream body can
// echo the application id, so nothing of it — not the text, not the status line — is carried into
// the error a participant eventually sees. The relay-credential route takes the same posture with
// its own key for the same reason.
//
// `fetch` is a constructor parameter rather than the global, so a test drives every path over a fake
// without a network and without the real credentials existing anywhere.

const REALTIME_BASE_URL = "https://rtc.live.cloudflare.com/v1/apps";

/** One end of the offer/answer exchange, exactly as both the browser and the service state it. */
export interface SfuSessionDescription {
  readonly type: string;
  readonly sdp: string;
}

/** Which side of the routing service a track sits on: published by this browser, or forwarded to it. */
export type SfuTrackLocation = "local" | "remote";

/**
 * WHICH SIMULCAST LAYER TO FORWARD, and what to do when it is not there.
 *
 * A camera publishes three layers at once; this is the subscriber's side of that, and it is the
 * whole of what the routing service needs to pick one. Both fallbacks are `asciibetical` because
 * the layer identifiers are chosen so that their alphabetical order IS their size order — `f` full,
 * `h` half, `q` quarter — so "the next one along" means "the next size down" without the service
 * being told anything about what the names mean. A publisher who has not started their camera yet
 * has no layers at all, and `ridNotAvailable` is what keeps that a smaller picture rather than a
 * refused subscription.
 */
export interface SfuSimulcastPreference {
  readonly preferredRid: string;
  readonly priorityOrdering: "asciibetical";
  readonly ridNotAvailable: "asciibetical";
}

/** The simulcast preference for one layer choice, built in one place so the two fallbacks agree. */
export function simulcastPreferenceFor(preferredRid: string): SfuSimulcastPreference {
  return { preferredRid, priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" };
}

export interface SfuTrackRequest {
  readonly location: SfuTrackLocation;
  readonly trackName?: string;
  readonly mid?: string;
  // The session that PUBLISHED the track, on a remote subscription. Absent on a local publish,
  // where the session is the one being addressed.
  readonly sessionId?: string;
  readonly kind?: string;
  // Only ever set on a remote subscription, and only for a track that has layers to choose between.
  // Omitted rather than defaulted: a preference the caller did not express must not become one the
  // service acts on.
  readonly simulcast?: SfuSimulcastPreference;
}

/** One already-forwarded track being asked to send a different layer, named by ITS media section. */
export interface SfuTrackUpdateRequest {
  readonly mid: string;
  readonly simulcast: SfuSimulcastPreference;
}

/** What the service said about one section it was asked to change. */
export interface SfuUpdatedTrack {
  readonly mid?: string;
  readonly errorCode?: string;
}

export interface SfuUpdateTracksResponse {
  readonly tracks: readonly SfuUpdatedTrack[];
}

// What the service says about one track it was asked to add. Every field is optional because an
// upstream answer that omits one is a fact the room has to be able to see and report, not a reason
// to throw somewhere a caller cannot act on it.
export interface SfuTrackResult {
  readonly location?: SfuTrackLocation;
  readonly mid?: string;
  readonly trackName?: string;
  readonly sessionId?: string;
  readonly errorCode?: string;
  readonly errorDescription?: string;
}

export interface SfuTracksResponse {
  // True when the service has changed the shape of the connection and is waiting for the browser to
  // answer. The room forwards it rather than deciding for the browser: only the browser's own peer
  // connection knows what it has already applied.
  readonly requiresImmediateRenegotiation: boolean;
  readonly sessionDescription?: SfuSessionDescription;
  readonly tracks: readonly SfuTrackResult[];
}

export interface SfuRenegotiateResponse {
  readonly sessionDescription?: SfuSessionDescription;
}

export interface SfuClosedTrack {
  readonly mid?: string;
  readonly errorCode?: string;
}

export interface SfuCloseTracksResponse {
  readonly requiresImmediateRenegotiation: boolean;
  readonly sessionDescription?: SfuSessionDescription;
  readonly tracks: readonly SfuClosedTrack[];
}

/** One track as the service currently holds it — what a reconciliation read returns. */
export interface SfuSessionTrack {
  readonly location?: SfuTrackLocation;
  readonly mid?: string;
  readonly trackName?: string;
  readonly sessionId?: string;
  readonly status?: "active" | "inactive" | "waiting";
}

export interface SfuSessionState {
  readonly tracks: readonly SfuSessionTrack[];
}

/**
 * The routing service did not answer, or answered something this client cannot read.
 *
 * ONE ERROR FOR BOTH, and it carries neither the upstream body nor the application id. A refused
 * request and a malformed answer are the same fact to a participant — the room cannot route their
 * media right now — and the difference between them is a deployment question, recorded through the
 * standard pipeline where the operation name lands beside the correlation id. Putting the upstream
 * text on the error would walk it out to a browser through the refusal frame, and that text names
 * the application the whole fleet's meetings run on.
 */
export class SfuUnavailableError extends Error {
  constructor(readonly operation: string) {
    super(`the media routing service did not answer (${operation})`);
    this.name = "SfuUnavailableError";
  }
}

export interface SfuClientOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly fetch: typeof fetch;
}

export class SfuClient {
  constructor(private readonly options: SfuClientOptions) {}

  /** Opens a session for one browser. Every track that browser publishes or receives hangs from it. */
  async createSession(): Promise<{ sessionId: string }> {
    const body = await this.call("sessions/new", "POST", undefined, "create-session");
    const sessionId = stringField(body, "sessionId");
    if (sessionId === undefined) throw new SfuUnavailableError("create-session");
    return { sessionId };
  }

  /**
   * Adds tracks to a session: the browser's own, carried on its offer, or another participant's,
   * named by the session that published them. The service answers with the description the browser
   * has to apply and the identifiers each track ended up on.
   */
  async addTracks(
    sessionId: string,
    request: {
      readonly sessionDescription?: SfuSessionDescription;
      readonly tracks: readonly SfuTrackRequest[];
      readonly autoDiscover?: boolean;
    },
  ): Promise<SfuTracksResponse> {
    const body = await this.call(
      `sessions/${encodeURIComponent(sessionId)}/tracks/new`,
      "POST",
      request,
      "add-tracks",
    );
    return {
      requiresImmediateRenegotiation: booleanField(body, "requiresImmediateRenegotiation") ?? false,
      sessionDescription: sessionDescriptionField(body),
      tracks: trackResults(body),
    };
  }

  /** Hands the service the browser's answer to a description it offered. */
  async renegotiate(
    sessionId: string,
    request: { readonly sessionDescription: SfuSessionDescription },
  ): Promise<SfuRenegotiateResponse> {
    const body = await this.call(
      `sessions/${encodeURIComponent(sessionId)}/renegotiate`,
      "PUT",
      request,
      "renegotiate",
    );
    return { sessionDescription: sessionDescriptionField(body) };
  }

  /**
   * Changes which layer already-forwarded tracks send, without touching the subscription itself.
   *
   * This is the call that makes a large room affordable: a browser paging through a gallery is
   * re-sizing streams it is already receiving, and asking for them again instead would renegotiate
   * the connection for media that is already arriving.
   */
  async updateTracks(
    sessionId: string,
    request: { readonly tracks: readonly SfuTrackUpdateRequest[] },
  ): Promise<SfuUpdateTracksResponse> {
    const body = await this.call(
      `sessions/${encodeURIComponent(sessionId)}/tracks/update`,
      "PUT",
      request,
      "update-tracks",
    );
    return { tracks: updatedTracks(body) };
  }

  /** Stops routing the named tracks — what a member turning their camera off eventually reaches. */
  async closeTracks(
    sessionId: string,
    request: {
      readonly tracks: readonly { readonly mid: string }[];
      readonly sessionDescription?: SfuSessionDescription;
      readonly force?: boolean;
    },
  ): Promise<SfuCloseTracksResponse> {
    const body = await this.call(
      `sessions/${encodeURIComponent(sessionId)}/tracks/close`,
      "PUT",
      request,
      "close-tracks",
    );
    return {
      requiresImmediateRenegotiation: booleanField(body, "requiresImmediateRenegotiation") ?? false,
      sessionDescription: sessionDescriptionField(body),
      tracks: closedTracks(body),
    };
  }

  /**
   * Stops routing EVERYTHING a session holds, for a participant the room has already let go of.
   *
   * The room normally knows the media sections it published and closes those by name. This is the
   * path for when it does not — a roster entry written before the media sections were recorded, or
   * a session the room is discarding wholesale — so it reads what the service is holding and closes
   * that. `force` because the browser is already gone: there is nobody left to answer a
   * renegotiation, and a graceful close would wait for one.
   */
  async closeSession(sessionId: string): Promise<void> {
    const state = await this.getSession(sessionId);
    const tracks = state.tracks.flatMap((track) =>
      track.mid === undefined ? [] : [{ mid: track.mid }],
    );
    if (tracks.length === 0) return;
    await this.closeTracks(sessionId, { tracks, force: true });
  }

  /** What the service currently holds for a session — the read that settles a disagreement about it. */
  async getSession(sessionId: string): Promise<SfuSessionState> {
    const body = await this.call(
      `sessions/${encodeURIComponent(sessionId)}`,
      "GET",
      undefined,
      "get-session",
    );
    return { tracks: sessionTracks(body) };
  }

  // The one place a request leaves this Worker. The bearer credential is set here and nowhere else,
  // and a non-2xx or unreadable answer becomes the one opaque error before any caller sees it.
  private async call(
    path: string,
    method: "GET" | "POST" | "PUT",
    body: unknown,
    operation: string,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.appSecret}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await this.options.fetch(
        `${REALTIME_BASE_URL}/${encodeURIComponent(this.options.appId)}/${path}`,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      );
    } catch {
      // A transport failure and a refusal are the same fact here. The thrown cause is deliberately
      // not attached: it can carry the request URL, which carries the application id.
      throw new SfuUnavailableError(operation);
    }
    if (!response.ok) throw new SfuUnavailableError(operation);

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new SfuUnavailableError(operation);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SfuUnavailableError(operation);
    }
    return parsed as Record<string, unknown>;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading an upstream body, which is UNKNOWN until each field has been checked.
//
// Nothing below trusts a shape. The service is Cloudflare's own and is not an adversary, but its
// answer crosses a version boundary this Worker does not control, and a field read as present when
// it is absent becomes an undefined interpolated into a signaling frame — where it fails inside a
// browser's connection machinery, far from anything that could name the cause.
// ---------------------------------------------------------------------------------------------

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function booleanField(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function sessionDescriptionField(
  source: Record<string, unknown>,
): SfuSessionDescription | undefined {
  const value = source["sessionDescription"];
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = stringField(record, "type");
  const sdp = stringField(record, "sdp");
  // Both halves or neither: a description missing its session-description protocol body is not
  // something a browser can apply, and passing it on would surface as a connection that never
  // completes rather than as the absence it is.
  return type === undefined || sdp === undefined ? undefined : { type, sdp };
}

function trackLocation(value: unknown): SfuTrackLocation | undefined {
  return value === "local" || value === "remote" ? value : undefined;
}

function objectEntries(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry),
  );
}

function trackResults(source: Record<string, unknown>): SfuTrackResult[] {
  return objectEntries(source, "tracks").map((entry) => ({
    location: trackLocation(entry["location"]),
    mid: stringField(entry, "mid"),
    trackName: stringField(entry, "trackName"),
    sessionId: stringField(entry, "sessionId"),
    errorCode: stringField(entry, "errorCode"),
    errorDescription: stringField(entry, "errorDescription"),
  }));
}

function updatedTracks(source: Record<string, unknown>): SfuUpdatedTrack[] {
  return objectEntries(source, "tracks").map((entry) => ({
    mid: stringField(entry, "mid"),
    errorCode: stringField(entry, "errorCode"),
  }));
}

function closedTracks(source: Record<string, unknown>): SfuClosedTrack[] {
  return objectEntries(source, "tracks").map((entry) => ({
    mid: stringField(entry, "mid"),
    errorCode: stringField(entry, "errorCode"),
  }));
}

function sessionTracks(source: Record<string, unknown>): SfuSessionTrack[] {
  return objectEntries(source, "tracks").map((entry) => {
    const status = entry["status"];
    return {
      location: trackLocation(entry["location"]),
      mid: stringField(entry, "mid"),
      trackName: stringField(entry, "trackName"),
      sessionId: stringField(entry, "sessionId"),
      status:
        status === "active" || status === "inactive" || status === "waiting" ? status : undefined,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Selection, and the one seam a test reaches it through.
// ---------------------------------------------------------------------------------------------

// A fake routing service, installed by a test and never by anything else.
//
// A Durable Object is constructed by the runtime with the deployment's own environment, so a test
// driving the meeting room cannot hand it an environment of its own the way a route test can. This
// module-level seam is the only place a fake can be attached for that path. Set, it stands in for
// BOTH halves of the selection below — the credentials and the transport — so a test never has to
// put a placeholder secret into an environment file where a real deployment would read it.
let fakeRoutingServiceFetch: typeof fetch | null = null;

// A module-level override that anything could set is a way to redirect the whole fleet's meetings at
// a chosen endpoint, so it is inert unless a test runner is what is running this code.
//
// UNDER THE WORKERS TEST POOL IT IS `import.meta.env.MODE`, measured rather than assumed:
// `process.env.VITEST` is undefined there even with the node compatibility flag on. The second
// reading is kept for a runner that bundles this module without Vite's define pass, where
// `import.meta.env` is absent and the node-side variable is the only signal. Neither is set in a
// deployment, and neither read may throw — this runs on the request path.
function runningUnderTest(): boolean {
  const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE;
  if (mode === "test") return true;
  // Read off `globalThis` rather than as a bare identifier: this Worker's types do not declare
  // `process`, and a runtime without the node compatibility layer has none.
  const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return nodeProcess?.env?.["VITEST"] !== undefined;
}

/** Installs (or, with null, removes) a fake routing service for the duration of a test. */
export function setSfuFetchForTests(fetchImplementation: typeof fetch | null): void {
  fakeRoutingServiceFetch = fetchImplementation;
}

/**
 * The client for this deployment, or null when meetings are not configured.
 *
 * NULL IS A FIRST-CLASS ANSWER rather than a failure: a deployment with no Realtime application has
 * nowhere to route media, which the create and join routes report as a 503 and the calendar reads as
 * "offer no way to start a meeting". Both credentials are required — one without the other is a
 * half-finished configuration that would fail at the first publish, deep inside a browser's
 * connection, instead of at the door.
 */
export function sfuClientForEnv(env: Bindings): SfuClient | null {
  const appId = env.REALTIME_SFU_APP_ID;
  const appSecret = env.REALTIME_SFU_APP_SECRET;
  // The environment is read FIRST and the seam only afterwards, so a deployment's answer is never
  // decided by a module variable: outside a test runner the override is not consulted at all.
  if (fakeRoutingServiceFetch !== null && runningUnderTest()) {
    return new SfuClient({
      appId: "test-realtime-application",
      appSecret: "test-realtime-secret",
      fetch: fakeRoutingServiceFetch,
    });
  }
  if (!appId || !appSecret) return null;
  return new SfuClient({ appId, appSecret, fetch: fetch.bind(globalThis) });
}
