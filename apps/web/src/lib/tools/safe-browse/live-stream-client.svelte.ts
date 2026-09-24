/*
 * The page's half of a live browsing stream: one socket to the member's remote browser, and the
 * state the viewer renders from.
 *
 * WHAT ARRIVES is pictures and text — JPEG frames, an address, the inspector's facts — parsed by the
 * shared protocol (`@magna-carta/safe-browse/live-stream-protocol`) and never treated as markup.
 * Frames go to whichever screen has attached itself; each is acknowledged only once it has been
 * drawn, which is what paces the stream to this connection: a slow one sees fewer frames, never a
 * backlog of stale ones.
 *
 * WHAT LEAVES is input, and only once the Worker has said the browser is ready. An address entered
 * while the stream is still opening is held and sent on `ready`; pointer and key input before then
 * is dropped, because there is no screen yet to have aimed it at.
 *
 * STARTING IS LAZY. Switching the viewer to Live opens nothing: a stream is opened by the first
 * address the member enters, because a held browser is billed from the moment it is acquired.
 *
 * A FAULT IS RETRIED HERE, VISIBLY, BEFORE IT IS REPORTED. A browser that could not be acquired (the
 * service at capacity, the acquisition budget spent) and a connection that dropped are both usually
 * transient, so the stream is reopened a bounded number of times, each attempt shown as it happens,
 * before the member is handed a failure with its Error ID. A dropped connection reopens onto the same
 * remote browser, cookies intact, because the Worker leaves it alive for exactly this.
 */
import {
  LIVE_VIEWPORT_DEFAULT,
  MAXIMUM_INSERTED_TEXT,
  parseLiveServerMessage,
  type LiveClientMessage,
  type LiveEndReason,
  type LiveView,
  type LiveViewport,
} from "@magna-carta/safe-browse/live-stream-protocol";
import type { Failure } from "$lib/api/problem.ts";
import { safeBrowseLiveSocketUrl } from "$lib/api/socket-url.ts";

export type LiveStreamStatus = "idle" | "connecting" | "open" | "ended";

/** Why the stream is not running, when it has stopped. `lost` is the connection dropping unannounced. */
export type LiveStopReason = LiveEndReason | "lost";

/** Something the remote browser did that the member should be told about, shown until the next page. */
export type LiveNotice =
  | { readonly kind: "refused" }
  | { readonly kind: "dialog"; readonly dialogKind: string; readonly message: string }
  | { readonly kind: "failed"; readonly action: "navigate" | "capture" };

export interface LiveDetails {
  readonly view: LiveView;
  readonly receivedAt: number;
  readonly elapsedMilliseconds: number | null;
}

/** Draws one frame; resolves once it is on screen. */
export type FrameDrawer = (data: string, width: number, height: number) => Promise<void>;

export interface LiveStreamSeams {
  openSocket(url: string): WebSocket;
  socketUrl(viewport: LiveViewport): string;
  now(): number;
  /** Run `callback` after `milliseconds`; returns the cancel. */
  after(milliseconds: number, callback: () => void): () => void;
}

const browserSeams: LiveStreamSeams = {
  openSocket: (url) => new WebSocket(url),
  socketUrl: (viewport) => safeBrowseLiveSocketUrl(viewport),
  now: () => Date.now(),
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

// A keepalive well inside any proxy's idle timeout. A page that is not changing sends no frames,
// and a socket carrying nothing for long enough is one something along the way will close.
const KEEPALIVE_INTERVAL_MILLISECONDS = 30_000;

// `WebSocket.OPEN`, spelled as its value so the client does not reach for a global the test
// environment may not define.
const SOCKET_OPEN = 1;

/** Attempts at opening a stream before a fault is reported, and the wait before each retry. */
export const LIVE_STREAM_MAXIMUM_ATTEMPTS = 3;
const RETRY_DELAYS_MILLISECONDS = [1_000, 3_000];

// The request line a failure record carries. Never an address: the stream's URL holds only a size.
const STREAM_REQUEST_LINE = "GET /api/v1/safe-browse/live/stream";

export class LiveStreamClient {
  status = $state<LiveStreamStatus>("idle");
  stopReason = $state<LiveStopReason | null>(null);
  /** When the stream stopped on a fault, after its retries: the record the failure notice renders. */
  failure = $state<Failure | null>(null);
  /** While a fault is being retried: which attempt is under way. */
  retrying = $state<{ attempt: number; maximumAttempts: number } | null>(null);
  /** The address being opened while the stream connects, for the loading screen to name. */
  opening = $state<string | null>(null);
  /** When the current connect began, for the loading screen's elapsed seconds. */
  connectingSince = $state<number | null>(null);
  location = $state<string | null>(null);
  title = $state<string | null>(null);
  canGoBack = $state(false);
  canGoForward = $state(false);
  loading = $state(false);
  /** Whether a frame has arrived since the stream opened — until then the screen has nothing to show. */
  showing = $state(false);
  /** The remote viewport, in the pixels pointer input is expressed in. */
  frameSize = $state<LiveViewport | null>(null);
  details = $state<LiveDetails | null>(null);
  notice = $state<LiveNotice | null>(null);
  /**
   * True when a stream opened on a FRESH browser after an earlier one this visit had a browser of
   * its own — the cookies from the pages before are gone, which changes how the next page behaves.
   */
  freshBrowserAfterEarlier = $state(false);

  readonly #seams: LiveStreamSeams;
  #socket: WebSocket | null = null;
  #viewport: LiveViewport = LIVE_VIEWPORT_DEFAULT;
  #heldNavigation: string | null = null;
  #drawer: FrameDrawer | null = null;
  #hadBrowser = false;
  #attempt = 1;
  #cancelRetry: (() => void) | null = null;
  #keepalive: ReturnType<typeof setInterval> | null = null;
  #captureWaiters: ((view: LiveView | null) => void)[] = [];

  constructor(seams: Partial<LiveStreamSeams> = {}) {
    this.#seams = { ...browserSeams, ...seams };
  }

  /** Go to an address, opening the stream first when there is none. */
  navigate(url: string): void {
    this.notice = null;
    if (this.status === "open") {
      this.#send({ type: "navigate", url });
      return;
    }
    this.#heldNavigation = url;
    this.opening = url;
    if (this.status !== "connecting") {
      this.#attempt = 1;
      this.#open();
    }
  }

  history(direction: "back" | "forward"): void {
    this.#send({ type: "history", direction });
  }

  reload(): void {
    this.#send({ type: "reload" });
  }

  /** Input from the screen. Dropped unless the stream is open. */
  input(message: Extract<LiveClientMessage, { type: "pointer" | "wheel" | "key" }>): void {
    this.#send(message);
  }

  paste(text: string): void {
    const trimmed = text.slice(0, MAXIMUM_INSERTED_TEXT);
    if (trimmed !== "") this.#send({ type: "text", text: trimmed });
  }

  /** The screen's size changed. Sent now when open; used for the next stream otherwise. */
  resize(viewport: LiveViewport): void {
    this.#viewport = viewport;
    this.#send({ type: "viewport", width: viewport.width, height: viewport.height });
  }

  /** The full view of the page as it stands, screenshot included; null when it could not be had. */
  capture(): Promise<LiveView | null> {
    if (this.status !== "open") return Promise.resolve(null);
    this.notice = null;
    return new Promise((resolve) => {
      this.#captureWaiters.push(resolve);
      this.#send({ type: "capture" });
    });
  }

  /** A screen attaching itself; frames are drawn by it until it detaches. */
  attachScreen(drawer: FrameDrawer): () => void {
    this.#drawer = drawer;
    return () => {
      if (this.#drawer === drawer) this.#drawer = null;
    };
  }

  /** Stop the stream from this side. The remote browser is released for the server to close. */
  close(): void {
    this.#heldNavigation = null;
    const socket = this.#socket;
    this.#teardown();
    this.status = "idle";
    this.stopReason = null;
    this.#clearPage();
    try {
      socket?.close(1000, "closed");
    } catch {
      // Already closed.
    }
  }

  #open(): void {
    this.status = "connecting";
    this.stopReason = null;
    this.failure = null;
    this.showing = false;
    this.connectingSince = this.#seams.now();
    let socket: WebSocket;
    try {
      socket = this.#seams.openSocket(this.#seams.socketUrl(this.#viewport));
    } catch {
      this.#fault("lost", null);
      return;
    }
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.#socket === socket) this.#receive(event.data);
    });
    socket.addEventListener("close", () => {
      if (this.#socket !== socket) return;
      // An `ended` frame has already said why; a close with none is the connection dropping.
      if (this.status === "ended") {
        this.#teardown();
        return;
      }
      this.#fault("lost", null);
    });
    this.#keepalive = setInterval(
      () => this.#send({ type: "ping" }),
      KEEPALIVE_INTERVAL_MILLISECONDS,
    );
  }

  #receive(raw: unknown): void {
    const message = parseLiveServerMessage(raw);
    if (message === null) return;
    switch (message.type) {
      case "ready": {
        this.status = "open";
        this.#attempt = 1;
        this.retrying = null;
        this.connectingSince = null;
        this.freshBrowserAfterEarlier = this.#hadBrowser && !message.sessionContinued;
        this.#hadBrowser = true;
        this.frameSize = message.viewport;
        const held = this.#heldNavigation;
        this.#heldNavigation = null;
        this.opening = null;
        if (held !== null) this.#send({ type: "navigate", url: held });
        return;
      }
      case "frame":
        this.frameSize = { width: message.width, height: message.height };
        this.showing = true;
        void this.#draw(message.data, message.width, message.height);
        return;
      case "location":
        this.location = message.url;
        this.title = message.title ?? null;
        this.canGoBack = message.canGoBack;
        this.canGoForward = message.canGoForward;
        return;
      case "loading":
        this.loading = message.loading;
        if (message.loading) this.notice = null;
        return;
      case "details":
        this.details = {
          view: message.view,
          receivedAt: this.#seams.now(),
          elapsedMilliseconds: message.elapsedMilliseconds,
        };
        return;
      case "capture":
        this.#resolveCaptures(message.view);
        return;
      case "refused":
        this.notice = { kind: "refused" };
        return;
      case "dialog":
        this.notice = { kind: "dialog", dialogKind: message.kind, message: message.message };
        return;
      case "failed":
        this.notice = { kind: "failed", action: message.action };
        if (message.action === "capture") this.#resolveCaptures(null);
        return;
      case "ended":
        if (message.reason === "failed") {
          this.#fault("failed", message.errorId ?? null);
          return;
        }
        this.status = "ended";
        this.stopReason = message.reason;
        this.loading = false;
        this.showing = false;
        return;
      case "pong":
        return;
    }
  }

  // A fault: retried while attempts remain, reported with its record once they are spent.
  #fault(reason: "failed" | "lost", errorId: string | null): void {
    this.#teardown();
    this.loading = false;
    this.showing = false;
    if (this.#attempt < LIVE_STREAM_MAXIMUM_ATTEMPTS) {
      const delay = RETRY_DELAYS_MILLISECONDS[this.#attempt - 1] ?? 3_000;
      this.#attempt += 1;
      this.status = "connecting";
      this.connectingSince = this.#seams.now();
      this.retrying = { attempt: this.#attempt, maximumAttempts: LIVE_STREAM_MAXIMUM_ATTEMPTS };
      // After a drop the browser is still where the member left it; reopening resumes it, and an
      // address held from before `ready` is sent once it does.
      this.#cancelRetry = this.#seams.after(delay, () => {
        this.#cancelRetry = null;
        this.#open();
      });
      return;
    }
    this.retrying = null;
    this.connectingSince = null;
    this.status = "ended";
    this.stopReason = reason;
    this.failure = {
      problem:
        errorId === null
          ? null
          : {
              status: 503,
              title: "The isolated browser could not be opened",
              errorId,
            },
      request: STREAM_REQUEST_LINE,
      failedAt: new Date(this.#seams.now()),
    };
  }

  async #draw(data: string, width: number, height: number): Promise<void> {
    try {
      await this.#drawer?.(data, width, height);
    } finally {
      // Acknowledged whether or not a screen drew it: an unacknowledged frame stops the stream, and
      // a member with the screen scrolled away still wants it to be live when they scroll back.
      this.#send({ type: "frameAck" });
    }
  }

  #send(message: LiveClientMessage): void {
    const socket = this.#socket;
    if (socket === null || this.status !== "open" || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify(message));
  }

  #resolveCaptures(view: LiveView | null): void {
    const waiters = this.#captureWaiters;
    this.#captureWaiters = [];
    for (const waiter of waiters) waiter(view);
  }

  #teardown(): void {
    if (this.#keepalive !== null) clearInterval(this.#keepalive);
    this.#keepalive = null;
    this.#cancelRetry?.();
    this.#cancelRetry = null;
    this.#socket = null;
    this.#resolveCaptures(null);
  }

  #clearPage(): void {
    this.location = null;
    this.title = null;
    this.canGoBack = false;
    this.canGoForward = false;
    this.loading = false;
    this.showing = false;
    this.details = null;
    this.notice = null;
    this.failure = null;
    this.retrying = null;
    this.opening = null;
    this.connectingSince = null;
    this.freshBrowserAfterEarlier = false;
  }
}
