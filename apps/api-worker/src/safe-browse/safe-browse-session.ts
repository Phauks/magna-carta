/*
 * One live browsing session, belonging to one member — and, while they are watching, the stream of
 * their remote browser.
 *
 * TWO LIVES, ONE OBJECT. Between streams the object holds a few dozen bytes: the remote browser's
 * session id and when the session began. It does not hold the browser, because a handle cannot
 * survive the object being evicted and an id can; reconnecting to the id is what the platform probe
 * measured. While a stream is open the object holds much more — the member's socket and a live
 * connection to the browser — and it stays in memory for exactly that long, because both ends are
 * open. That is why the socket is accepted with the ordinary API rather than hibernation: a
 * hibernated object would drop the browser connection that is the whole point of being awake.
 *
 * It holds no browsing history. A member walking a suspect link through its steps is doing security
 * hygiene, not building a record, and a per-member log of the dubious addresses they visited is a
 * liability rather than a feature.
 *
 * ADDRESSED `${firmId}:${userId}`, firm-namespaced for the same reason the live timer is: a session
 * named by user id alone could be reached from another firm by a caller who knew the id. The firm
 * comes from the chokepoint's resolved session, never from anything the request carries.
 *
 * ONE STREAM PER MEMBER. A second tab opening Live takes the stream over: the first is told it was
 * replaced and lets go of the browser, and the second reconnects to the same one — cookies intact.
 *
 * THE ALARM IS THE COST CONTROL. A held browser is billed for the time it is held. While a stream is
 * open the alarm asks it whether it has gone idle or reached its total-life ceiling and ends it if
 * so; with no stream open, it closes the browser a dropped connection left behind.
 */
import { DurableObject } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import {
  LIVE_SESSION_IDLE_MILLISECONDS,
  planLiveSession,
  type LiveSessionRecord,
} from "@magna-carta/safe-browse";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { LiveViewport } from "@magna-carta/safe-browse/live-stream-protocol";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import { LiveStream, type LiveBrowserOpener } from "./live-stream.ts";
import { createPuppeteerLiveOpener } from "./puppeteer-live-browser.ts";

const RECORD_KEY = "session";

// The internal address the stream route hands the upgrade to. Built by the route from validated
// numbers only, so nothing the caller sent travels inward except the size of their screen.
const STREAM_REQUEST_ORIGIN = "https://safe-browse-session.invalid";

/** The request the route sends inward to open a stream, built from scratch rather than forwarded. */
export function streamRequest(viewport: LiveViewport | null): Request {
  const url = new URL("/stream", STREAM_REQUEST_ORIGIN);
  if (viewport !== null) {
    url.searchParams.set("width", String(viewport.width));
    url.searchParams.set("height", String(viewport.height));
  }
  return new Request(url, { headers: { Upgrade: "websocket" } });
}

function viewportFromStreamRequest(request: Request): LiveViewport | null {
  const parameters = new URL(request.url).searchParams;
  const width = Number(parameters.get("width"));
  const height = Number(parameters.get("height"));
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

export class SafeBrowseSession extends DurableObject<{
  BROWSER: unknown;
  TELEMETRY?: AnalyticsEngineDataset;
}> {
  #stream: LiveStream | null = null;

  /*
   * The browser seam. Production drives the Browser Rendering binding; a test replaces this on the
   * instance, because the local pool has no browser and the object's decisions — takeover, the
   * record it keeps, when the alarm ends a stream — would otherwise go unchecked.
   */
  openLiveBrowser: () => LiveBrowserOpener = () =>
    createPuppeteerLiveOpener(this.env.BROWSER as BrowserWorker);

  /** What browser this member has, if any. */
  async read(): Promise<LiveSessionRecord | null> {
    return (await this.ctx.storage.get<LiveSessionRecord>(RECORD_KEY)) ?? null;
  }

  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return new Response("this endpoint serves the live stream only", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    // One stream per member: the earlier one lets go of the browser so this one can take it.
    const previous = this.#stream;
    if (previous !== null) await previous.end("replaced", "release");

    const stream = new LiveStream({
      socket: server,
      opener: this.openLiveBrowser(),
      reportFailure: (error) =>
        logOperationFailed(
          createWorkersLogger(this.env.TELEMETRY),
          "route:safeBrowse.liveStream",
          // The class of what failed and nothing else: the upstream message can quote an address.
          new Error(
            `the live browser could not be held (${error instanceof Error ? error.name : "unknown"})`,
          ),
        ),
    });
    this.#stream = stream;
    server.addEventListener("message", (event) => stream.receive(event.data));
    const onGone = () => {
      void stream.socketClosed();
      if (this.#stream !== stream) return;
      this.#stream = null;
      // The browser is left alive so a dropped connection can come back to it, cookies and all —
      // for the idle window and no longer; the alarm then closes it rather than bill for a browser
      // nobody returned to.
      void this.ctx.storage.setAlarm(Date.now() + LIVE_SESSION_IDLE_MILLISECONDS);
    };
    server.addEventListener("close", onGone);
    server.addEventListener("error", onGone);

    // The 101 goes back now; the browser is acquired behind it and the member is sent `ready` when
    // it is theirs. Acquiring first would hold the upgrade open for a cold launch.
    void this.#begin(stream, viewportFromStreamRequest(request));
    return new Response(null, { status: 101, webSocket: client });
  }

  async #begin(stream: LiveStream, viewport: LiveViewport | null): Promise<void> {
    const record = await this.read();
    const started = await stream.start(planLiveSession(record, Date.now()), viewport, (carried) =>
      carried.kind === "connect" && record !== null ? record.openedAt : Date.now(),
    );
    if (started === null) {
      if (stream.ended && this.#stream === stream) this.#stream = null;
      return;
    }
    await this.ctx.storage.put(RECORD_KEY, {
      sessionId: started.sessionId,
      openedAt: started.openedAt,
    } satisfies LiveSessionRecord);
    await this.ctx.storage.setAlarm(stream.nextDeadline());
  }

  /**
   * End the session: close the remote browser and forget it. Safe to call when there is nothing to
   * close, because the member's "close" and the alarm both arrive here and either may be first.
   */
  async end(): Promise<void> {
    const stream = this.#stream;
    this.#stream = null;
    const record = await this.read();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    if (stream !== null && !stream.ended) {
      await stream.end("closed", "close");
      return;
    }
    if (record === null) return;
    try {
      const browser = await puppeteer.connect(this.env.BROWSER as BrowserWorker, record.sessionId);
      await browser.close();
    } catch {
      // The service reaps idle sessions itself, so a browser that has already gone is the expected
      // case rather than a fault. Either way the record is cleared above — a close that threw must
      // not leave a member pinned to a browser that no longer exists.
    }
  }

  override async alarm(): Promise<void> {
    const stream = this.#stream;
    if (stream !== null && !stream.ended) {
      const due = stream.dueReason(Date.now());
      if (due === null) {
        // Still in use: look again when it could next be due.
        await this.ctx.storage.setAlarm(stream.nextDeadline());
        return;
      }
      this.#stream = null;
      await this.ctx.storage.deleteAll();
      await stream.end(due, "close");
      return;
    }
    // No stream open: whatever browser is recorded was left for a reconnect that did not come.
    await this.end();
  }
}
