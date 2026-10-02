/*
 * One member's live stream: their socket on one side, the remote browser on the other, and the
 * rules that sit between them.
 *
 * WHAT THIS DECIDES, apart from the machinery that carries it out (the puppeteer adapter beside it):
 *   - which frames of the member's input reach the browser — only what `parseLiveClientMessage`
 *     accepts, and an address only after `assertPublicTarget` has passed it;
 *   - how fast pictures flow back — one frame in flight to the member at a time, so a slow
 *     connection sees a lower frame rate rather than a growing queue of stale screens;
 *   - when the stream ends — idle, the total-life ceiling, the member leaving, or another tab taking
 *     over — and whether the remote browser is closed or left for the next stream to reconnect to.
 * Kept free of puppeteer so each of those is checked by a test with a fake browser, since the test
 * pool has no real one.
 *
 * NOTHING THE PAGE SENDS IS EXECUTED. What reaches the member is a JPEG, an address and the
 * inspector's text; what reaches the browser is a pointer position, a key name or pasted text. Each
 * direction carries data, never code — the same line the static capture holds, drawn per frame.
 */
import { SsrfRejection, assertPublicTarget } from "@magna-carta/integrations/safe-target";
import type { LiveSessionPlan } from "@magna-carta/safe-browse";
import {
  LIVE_VIEWPORT_DEFAULT,
  clampViewport,
  parseLiveClientMessage,
  type LiveClientMessage,
  type LiveEndReason,
  type LiveServerMessage,
  type LiveView,
  type LiveViewport,
} from "@magna-carta/safe-browse/live-stream-protocol";
import {
  LIVE_SESSION_IDLE_MILLISECONDS,
  LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS,
} from "@magna-carta/safe-browse";

export type PointerInput = Extract<LiveClientMessage, { type: "pointer" }>;
export type WheelInput = Extract<LiveClientMessage, { type: "wheel" }>;
export type KeyInput = Extract<LiveClientMessage, { type: "key" }>;

/** What the remote browser reports while a stream holds it. */
export interface LiveBrowserEvents {
  /** A picture of the screen. `acknowledge` lets the browser send the next one. */
  frame(frame: { data: string; width: number; height: number }, acknowledge: () => void): void;
  location(state: { url: string; title?: string; canGoBack: boolean; canGoForward: boolean }): void;
  loading(loading: boolean): void;
  /** The page's load event fired; `elapsedMilliseconds` runs from its navigation starting. */
  loaded(elapsedMilliseconds: number | null): void;
  /** The address guard refused a navigation in the main frame. */
  refused(): void;
  /** The page raised a dialog, already dismissed. */
  dialog(kind: string, message: string): void;
  /** The browser went away without the stream asking it to. */
  disconnected(): void;
}

/** The remote browser, as the stream drives it. */
export interface LiveBrowser {
  readonly sessionId: string;
  /** Start a navigation. Resolves once it is under way, not when the page has loaded. */
  navigate(url: string): Promise<void>;
  history(direction: "back" | "forward"): Promise<void>;
  reload(): Promise<void>;
  pointer(input: PointerInput): Promise<void>;
  wheel(input: WheelInput): Promise<void>;
  key(input: KeyInput): Promise<void>;
  insertText(text: string): Promise<void>;
  resize(viewport: LiveViewport): Promise<void>;
  /** The inspector's facts about the page on show; with a full-page screenshot when asked. */
  inspect(withScreenshot: boolean): Promise<LiveView>;
  /** Stop streaming and disconnect, leaving the browser alive for the next stream to reconnect to. */
  release(): Promise<void>;
  /** Close the browser for good. */
  close(): Promise<void>;
}

export interface LiveBrowserOpener {
  /**
   * Acquire the browser the plan names — reconnecting or launching — and start it streaming. The
   * plan that comes back is the one actually carried out: a connect to a reaped browser comes back
   * as a launch.
   */
  open(
    plan: LiveSessionPlan,
    viewport: LiveViewport,
    events: LiveBrowserEvents,
  ): Promise<{ browser: LiveBrowser; plan: LiveSessionPlan }>;
}

/** The member's end of the socket — the two things the stream does to it. */
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type PendingFrame = {
  frame: { data: string; width: number; height: number };
  acknowledge: () => void;
};

export class LiveStream {
  readonly #socket: LiveSocket;
  readonly #opener: LiveBrowserOpener;
  readonly #now: () => number;
  readonly #reportFailure: (error: unknown) => string | null;
  #browser: LiveBrowser | null = null;
  #viewport: LiveViewport = LIVE_VIEWPORT_DEFAULT;
  #openedAt = 0;
  #lastActivity = 0;
  #ended = false;
  // Flow control: at most one frame on its way to the member. A frame the browser produces while
  // one is outstanding is held (the newest replacing any older one) and sent when the member acks.
  #frameOutstanding = false;
  #pendingFrame: PendingFrame | null = null;
  // Input is dispatched in the order it arrived. A pointer-up overtaking its pointer-down is a
  // click that never happened.
  #inputQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    socket: LiveSocket;
    opener: LiveBrowserOpener;
    now?: () => number;
    /**
     * Record a failure through the standard pipeline and return its Error ID, which the member is
     * shown. The error it is handed never reaches the member — only the ID does.
     */
    reportFailure?: (error: unknown) => string | null;
  }) {
    this.#socket = options.socket;
    this.#opener = options.opener;
    this.#now = options.now ?? Date.now;
    this.#reportFailure = options.reportFailure ?? (() => null);
    this.#lastActivity = this.#now();
  }

  get ended(): boolean {
    return this.#ended;
  }

  /**
   * Acquire the browser and start streaming. Returns the session to record, or null when no
   * browser could be had — in which case the member has already been told and the socket closed.
   * `openedAt` is when the member's session began, carried across reconnects so the total-life
   * ceiling counts from the first stream rather than resetting on every one.
   */
  async start(
    plan: LiveSessionPlan,
    requestedViewport: LiveViewport | null,
    openedAt: (carried: LiveSessionPlan) => number,
  ): Promise<{ sessionId: string; plan: LiveSessionPlan; openedAt: number } | null> {
    this.#viewport = clampViewport(requestedViewport ?? LIVE_VIEWPORT_DEFAULT);
    let opened: Awaited<ReturnType<LiveBrowserOpener["open"]>>;
    try {
      opened = await this.#opener.open(plan, this.#viewport, this.#events());
    } catch (error) {
      await this.end("failed", "none", this.#reportFailure(error));
      return null;
    }
    // The member may have gone while the browser was being acquired. Leave it for them to come
    // back to rather than billing a stream nobody is watching.
    if (this.#ended) {
      await opened.browser.release().catch(() => {});
      return null;
    }
    this.#browser = opened.browser;
    this.#openedAt = openedAt(opened.plan);
    this.#lastActivity = this.#now();
    this.#send({
      type: "ready",
      sessionContinued: opened.plan.kind === "connect",
      viewport: this.#viewport,
    });
    return { sessionId: opened.browser.sessionId, plan: opened.plan, openedAt: this.#openedAt };
  }

  /** One frame from the member's socket. */
  receive(raw: unknown): void {
    if (this.#ended) return;
    const message = parseLiveClientMessage(raw);
    if (message === null) return;
    if (message.type === "ping") {
      this.#send({ type: "pong" });
      return;
    }
    if (message.type === "frameAck") {
      this.#frameAcknowledged();
      return;
    }
    const browser = this.#browser;
    // Input before the browser is ready has nowhere to go; the page waits for `ready` before it
    // sends any, so this drops only what a misbehaving caller sent early.
    if (browser === null) return;
    if (message.type !== "viewport") this.#lastActivity = this.#now();

    switch (message.type) {
      case "navigate":
        void this.#navigate(browser, message.url);
        return;
      case "history":
        void browser.history(message.direction).catch(() => this.#failed("navigate"));
        return;
      case "reload":
        void browser.reload().catch(() => this.#failed("navigate"));
        return;
      case "capture":
        void browser.inspect(true).then(
          (view) => this.#send({ type: "capture", view }),
          () => this.#failed("capture"),
        );
        return;
      case "viewport": {
        const next = clampViewport(message);
        if (next.width === this.#viewport.width && next.height === this.#viewport.height) return;
        this.#viewport = next;
        this.#enqueue(() => browser.resize(next));
        return;
      }
      case "pointer":
        this.#enqueue(() => browser.pointer(message));
        return;
      case "wheel":
        this.#enqueue(() => browser.wheel(message));
        return;
      case "key":
        this.#enqueue(() => browser.key(message));
        return;
      case "text":
        this.#enqueue(() => browser.insertText(message.text));
        return;
    }
  }

  /** Why the stream should end now, or null when it should carry on. */
  dueReason(now: number): LiveEndReason | null {
    if (now - this.#openedAt >= LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS) return "ceiling";
    if (now - this.#lastActivity >= LIVE_SESSION_IDLE_MILLISECONDS) return "idle";
    return null;
  }

  /** When the stream next needs looking at: the earlier of going idle and reaching the ceiling. */
  nextDeadline(): number {
    return Math.min(
      this.#lastActivity + LIVE_SESSION_IDLE_MILLISECONDS,
      this.#openedAt + LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS,
    );
  }

  /**
   * End the stream, telling the member why. `release` leaves the browser for a reconnect (another
   * tab taking over, a dropped connection); `close` ends it (idle, ceiling, the member leaving);
   * `none` is for a stream that never had one.
   */
  async end(
    reason: LiveEndReason,
    browserOutcome: "release" | "close" | "none",
    errorId: string | null = null,
  ): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    this.#send({ type: "ended", reason, ...(errorId !== null && { errorId }) });
    try {
      this.#socket.close(1000, reason);
    } catch {
      // Already closed from the member's side.
    }
    await this.#retire(browserOutcome);
  }

  /** The member's socket closed. Their browser stays for a reconnect; the idle alarm is the backstop. */
  async socketClosed(): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    await this.#retire("release");
  }

  async #retire(browserOutcome: "release" | "close" | "none"): Promise<void> {
    const browser = this.#browser;
    this.#browser = null;
    this.#pendingFrame?.acknowledge();
    this.#pendingFrame = null;
    if (browser === null || browserOutcome === "none") return;
    await (browserOutcome === "close" ? browser.close() : browser.release()).catch(() => {});
  }

  async #navigate(browser: LiveBrowser, url: string): Promise<void> {
    // The typed address first, before the browser sees it. Every hop after it — each redirect and
    // each navigation the page starts on its own — is guarded again inside the browser adapter,
    // which is where the per-hop half of the rule lives.
    let target: URL;
    try {
      target = (await assertPublicTarget(url)).url;
    } catch (error) {
      if (error instanceof SsrfRejection) {
        this.#send({ type: "refused" });
        return;
      }
      throw error;
    }
    await browser.navigate(target.href).catch(() => this.#failed("navigate"));
  }

  #enqueue(dispatch: () => Promise<void>): void {
    // A dispatch that fails is dropped rather than ending the stream: a key the browser could not
    // place is not a reason to take the page away from the member.
    this.#inputQueue = this.#inputQueue.then(dispatch).catch(() => {});
  }

  #failed(action: "navigate" | "capture"): void {
    this.#send({ type: "failed", action });
  }

  #frameAcknowledged(): void {
    this.#frameOutstanding = false;
    const pending = this.#pendingFrame;
    if (pending === null) return;
    this.#pendingFrame = null;
    this.#deliverFrame(pending);
  }

  #deliverFrame(pending: PendingFrame): void {
    this.#frameOutstanding = true;
    this.#send({ type: "frame", ...pending.frame });
    pending.acknowledge();
  }

  #events(): LiveBrowserEvents {
    return {
      frame: (frame, acknowledge) => {
        if (this.#ended) {
          acknowledge();
          return;
        }
        if (!this.#frameOutstanding) {
          this.#deliverFrame({ frame, acknowledge });
          return;
        }
        // Held, not acknowledged: the browser sends no more until this one moves, so a member on a
        // slow connection costs one held frame, not a backlog. An older held frame is superseded —
        // and acknowledged, so the browser is not left waiting on a frame nobody will send.
        this.#pendingFrame?.acknowledge();
        this.#pendingFrame = { frame, acknowledge };
      },
      location: (state) => this.#send({ type: "location", ...state }),
      loading: (loading) => this.#send({ type: "loading", loading }),
      loaded: (elapsedMilliseconds) => {
        const browser = this.#browser;
        if (browser === null) return;
        // The inspector's facts refresh with every page, without the screenshot: the member is
        // looking at the page itself, and a full-page image per load would be megabytes nobody
        // asked for. The download asks for one explicitly.
        void browser.inspect(false).then(
          (view) => this.#send({ type: "details", view, elapsedMilliseconds }),
          () => {},
        );
      },
      refused: () => this.#send({ type: "refused" }),
      dialog: (kind, message) => this.#send({ type: "dialog", kind, message }),
      disconnected: () => {
        void this.end(
          "failed",
          "none",
          this.#reportFailure(new Error("the live browser disconnected mid-stream")),
        );
      },
    };
  }

  #send(message: LiveServerMessage): void {
    try {
      this.#socket.send(JSON.stringify(message));
    } catch {
      // The socket closed under us; its close handler ends the stream.
    }
  }
}
