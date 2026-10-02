/*
 * The remote browser behind a live stream, driven over the Chrome DevTools Protocol.
 *
 * Everything here is machinery the stream (live-stream.ts) decides about; the one decision made
 * HERE is the per-hop address guard, because it has to sit where the browser's requests are.
 *
 * THE GUARD COVERS EVERY DOCUMENT FOR THE WHOLE SESSION. A streamed browser is one the member
 * clicks around in, so a hostile page has the whole session — not one navigation — to send it
 * somewhere it should not go. `Fetch.enable` is scoped to requests whose resource type is Document:
 * every main-frame and sub-frame navigation, every redirect hop of one, pauses until
 * `assertPublicTarget` has passed its address, and only documents pause — images, scripts and
 * fetches go straight through, so the guard costs nothing on the hundreds of requests a page makes.
 * Those sub-resources are the same line the static capture draws: the browser fetching them runs in
 * the rendering service's network, not this platform's. A refused main-frame document is reported
 * to the member; a refused sub-frame is blocked alone, so an iframe pointing inward does not make
 * the page unviewable.
 *
 * WHAT ELSE IS SHUT, and why each would otherwise leak past the screen:
 *   - popups and `target="_blank"`: a new tab is a page nobody is streaming, so links and
 *     `window.open` are folded into the one visible tab, and a tab that opens anyway is closed and
 *     its address followed in the visible one — through the guard;
 *   - downloads: denied, because a file saved on the remote machine is a file nobody asked for;
 *   - the file chooser: intercepted, so an upload form cannot open a dialog that has no member
 *     machine behind it;
 *   - alerts, confirms and prompts: dismissed and reported, because a dialog freezes the page and a
 *     frozen stream looks like a broken tool.
 */
import puppeteer, { TargetType } from "@cloudflare/puppeteer";
import type {
  Browser,
  BrowserWorker,
  HTTPResponse,
  KeyInput,
  Page,
  Target,
} from "@cloudflare/puppeteer";
import { assertPublicTarget } from "@magna-carta/integrations/safe-target";
import { planLiveSession, type LiveSessionPlan } from "@magna-carta/safe-browse";
import {
  clampToViewport,
  type LiveView,
  type LiveViewport,
} from "@magna-carta/safe-browse/live-stream-protocol";
import type {
  KeyInput as LiveKeyInput,
  LiveBrowser,
  LiveBrowserEvents,
  LiveBrowserOpener,
  PointerInput,
  WheelInput,
} from "./live-stream.ts";

// The service's keep-alive for a browser nobody is connected to — how long a dropped stream can be
// resumed with its cookies. Under the service's ten-minute ceiling; the session object's idle alarm
// is shorter still and is what actually retires a session.
const KEEP_ALIVE_MILLISECONDS = 5 * 60 * 1000;

// Caps on what a page can make the details frame carry. A hostile page chooses its own size.
const MAXIMUM_LINKS = 500;
const MAXIMUM_TEXT_CHARACTERS = 200_000;
const MAXIMUM_DIALOG_MESSAGE = 500;

// JPEG at this quality is legible text at a fraction of PNG's size; frames are the whole bandwidth
// bill of a stream, paid on the member's connection.
const FRAME_QUALITY = 70;

/*
 * Runs in the remote page before its own scripts, in every document. It folds new-tab navigation
 * into the visible tab: `window.open` becomes a same-tab navigation and a `target` attribute is
 * removed from a link or form at the moment it is used. A page can undo this — it is the page's
 * own world — which is why a tab that opens anyway is also caught at the browser (below).
 */
const SINGLE_TAB_SCRIPT = `(() => {
  const follow = (address) => {
    if (address) window.location.href = new URL(String(address), window.location.href).href;
    return null;
  };
  try { window.open = follow; } catch {}
  const untarget = (event) => {
    const element = event.target && event.target.closest
      ? event.target.closest("a[target], area[target], form[target]")
      : null;
    if (element) element.removeAttribute("target");
  };
  document.addEventListener("click", untarget, true);
  document.addEventListener("auxclick", untarget, true);
  document.addEventListener("submit", untarget, true);
})();`;

// One user-perceived character, however many code points it takes — an accented letter typed as a
// base and a combining mark is still one key press.
const graphemes = new Intl.Segmenter();
function isOneCharacter(text: string): boolean {
  const iterator = graphemes.segment(text)[Symbol.iterator]();
  return !iterator.next().done && iterator.next().done === true;
}

// CDP's `buttons` bitmask, which a mouse move must carry while a button is held — without it a drag
// is a hover.
const BUTTON_BITS: Record<PointerInput["button"], number> = {
  none: 0,
  left: 1,
  right: 2,
  middle: 4,
};

/** The production opener: a Browser Rendering session, reconnected or launched per the plan. */
export function createPuppeteerLiveOpener(binding: BrowserWorker): LiveBrowserOpener {
  return {
    async open(plan, viewport, events) {
      let carried: LiveSessionPlan = plan;
      let browser: Browser;
      if (plan.kind === "connect") {
        try {
          browser = await puppeteer.connect(binding, plan.sessionId);
        } catch {
          // A recorded id the service has already reaped. Not a fault: start a fresh browser and
          // let the stream tell the member their cookies are gone.
          carried = planLiveSession(null, Date.now(), true);
          browser = await puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MILLISECONDS });
        }
      } else {
        browser = await puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MILLISECONDS });
      }
      try {
        return { browser: await drive(browser, viewport, events), plan: carried };
      } catch (error) {
        await browser.disconnect().catch(() => {});
        throw error;
      }
    },
  };
}

async function drive(
  browser: Browser,
  initialViewport: LiveViewport,
  events: LiveBrowserEvents,
): Promise<LiveBrowser> {
  const pages = await browser.pages();
  const page: Page = pages[0] ?? (await browser.newPage());
  // Tabs a previous stream's page managed to open are nobody's to watch.
  await Promise.all(pages.slice(1).map((stray) => stray.close().catch(() => {})));

  let viewport = initialViewport;
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });

  const cdp = await page.createCDPSession();
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const mainFrameId = frameTree.frame.id;
  await cdp.send("Page.enable");

  // The guard, first: nothing navigates before it is in place.
  cdp.on("Fetch.requestPaused", (event) => {
    void assertPublicTarget(event.request.url).then(
      () => cdp.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => {}),
      () => {
        if (event.frameId === mainFrameId) events.refused();
        void cdp
          .send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" })
          .catch(() => {});
      },
    );
  });
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
  });

  await cdp.send("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true }).catch(() => {});
  await page.evaluateOnNewDocument(SINGLE_TAB_SCRIPT);

  const onDialog = (dialog: Parameters<Parameters<typeof page.on<"dialog">>[1]>[0]) => {
    events.dialog(dialog.type(), dialog.message().slice(0, MAXIMUM_DIALOG_MESSAGE));
    // A leave-this-page prompt is accepted, so the member's navigation goes where they asked;
    // everything else is dismissed, so nothing the page asked is answered yes on their behalf.
    void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()).catch(() => {});
  };
  page.on("dialog", onDialog);

  const onTarget = (target: Target) => {
    if (target.type() !== TargetType.PAGE || target === page.target()) return;
    void (async () => {
      const opened = await target.page().catch(() => null);
      const address = target.url();
      await opened?.close().catch(() => {});
      // Followed in the visible tab, where the guard sees it.
      if (/^https?:/i.test(address)) {
        await cdp.send("Page.navigate", { url: address }).catch(() => {});
      }
    })();
  };
  browser.on("targetcreated", onTarget);

  // The main document's answer, kept for the inspector: its headers and the redirect chain the
  // browser actually walked, cookies and all.
  let lastDocument: HTTPResponse | null = null;
  const onResponse = (response: HTTPResponse) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      lastDocument = response;
    }
  };
  page.on("response", onResponse);

  const reportLocation = async () => {
    const history = await cdp.send("Page.getNavigationHistory");
    const entry = history.entries[history.currentIndex];
    events.location({
      url: entry?.url ?? page.url(),
      ...(entry?.title ? { title: entry.title } : {}),
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
    });
  };

  let navigationStartedAt: number | null = null;
  cdp.on("Page.frameStartedLoading", (event) => {
    if (event.frameId !== mainFrameId) return;
    navigationStartedAt = Date.now();
    events.loading(true);
  });
  cdp.on("Page.frameStoppedLoading", (event) => {
    if (event.frameId === mainFrameId) events.loading(false);
  });
  cdp.on("Page.frameNavigated", (event) => {
    if (event.frame.id === mainFrameId) void reportLocation().catch(() => {});
  });
  cdp.on("Page.navigatedWithinDocument", (event) => {
    if (event.frameId === mainFrameId) void reportLocation().catch(() => {});
  });
  cdp.on("Page.loadEventFired", () => {
    const elapsed = navigationStartedAt === null ? null : Date.now() - navigationStartedAt;
    navigationStartedAt = null;
    void reportLocation().catch(() => {});
    events.loaded(elapsed);
  });

  cdp.on("Page.screencastFrame", (event) => {
    events.frame(
      {
        data: event.data,
        width: Math.round(event.metadata.deviceWidth),
        height: Math.round(event.metadata.deviceHeight),
      },
      () =>
        void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {}),
    );
  });
  const startScreencast = () =>
    cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: FRAME_QUALITY,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: 1,
    });
  await startScreencast();

  // Whatever page a reconnected browser was left on, the member sees where it is straight away.
  await reportLocation().catch(() => {});

  let released = false;
  const onDisconnected = () => {
    if (!released) events.disconnected();
  };
  browser.on("disconnected", onDisconnected);

  let buttonsHeld = 0;

  const history = async (direction: "back" | "forward") => {
    const current = await cdp.send("Page.getNavigationHistory");
    const entry = current.entries[current.currentIndex + (direction === "back" ? -1 : 1)];
    if (entry === undefined) return;
    await cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  };

  const detach = async () => {
    released = true;
    browser.off("disconnected", onDisconnected);
    browser.off("targetcreated", onTarget);
    page.off("dialog", onDialog);
    page.off("response", onResponse);
    await cdp.send("Page.stopScreencast").catch(() => {});
    // Interception off before the connection goes: left on, the page's next navigation would pause
    // waiting for a handler that no longer exists.
    await cdp.send("Fetch.disable").catch(() => {});
    await cdp.detach().catch(() => {});
  };

  return {
    sessionId: browser.sessionId(),

    async navigate(url) {
      const result = await cdp.send("Page.navigate", { url });
      // A refused hop surfaces here as blocked-by-client, and the guard has already told the member
      // why. Anything else is a navigation that did not start.
      if (result.errorText && !result.errorText.includes("BLOCKED_BY_CLIENT")) {
        throw new Error("the navigation did not start");
      }
    },

    history,

    async reload() {
      await cdp.send("Page.reload", {});
    },

    async pointer(input) {
      const { x, y } = clampToViewport(input, viewport);
      if (input.action === "down") buttonsHeld |= BUTTON_BITS[input.button];
      if (input.action === "up") buttonsHeld &= ~BUTTON_BITS[input.button];
      await cdp.send("Input.dispatchMouseEvent", {
        type:
          input.action === "move"
            ? "mouseMoved"
            : input.action === "down"
              ? "mousePressed"
              : "mouseReleased",
        x,
        y,
        button: input.button,
        buttons: buttonsHeld,
        clickCount: input.clickCount,
        modifiers: input.modifiers,
      });
    },

    async wheel(input: WheelInput) {
      const { x, y } = clampToViewport(input, viewport);
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX: input.deltaX,
        deltaY: input.deltaY,
        modifiers: input.modifiers,
      });
    },

    async key(input: LiveKeyInput) {
      // Named keys and the printable layout go through puppeteer's keyboard, which knows each key's
      // code and the text it types; a character outside that layout (an accented letter, a symbol
      // from another layout) is typed as the character itself.
      if (input.action === "down") {
        try {
          await page.keyboard.down(input.key as KeyInput);
        } catch {
          if (isOneCharacter(input.key)) await page.keyboard.sendCharacter(input.key);
        }
        return;
      }
      await page.keyboard.up(input.key as KeyInput).catch(() => {});
    },

    async insertText(text) {
      await cdp.send("Input.insertText", { text });
    },

    async resize(next) {
      viewport = next;
      await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
      // The screencast's size bound is fixed when it starts, so a new size needs a new screencast.
      await cdp.send("Page.stopScreencast").catch(() => {});
      await startScreencast();
    },

    async inspect(withScreenshot): Promise<LiveView> {
      const response = lastDocument;
      const [screenshot, title, links, text] = await Promise.all([
        withScreenshot
          ? page.screenshot({ encoding: "base64", fullPage: true })
          : Promise.resolve(""),
        page.title().catch(() => undefined),
        page
          // The callback is serialized and runs inside the remote page, not in this Worker, so it
          // cannot name a DOM type this build has no lib for; the shape is asserted structurally.
          .$$eval(
            "a[href]",
            (anchors, maximum) =>
              anchors
                .map((anchor) => (anchor as unknown as { href: string }).href)
                .slice(0, maximum),
            MAXIMUM_LINKS,
          )
          .catch(() => [] as string[]),
        page
          .evaluate(
            (maximum) =>
              (
                (globalThis as unknown as { document?: { body?: { innerText?: string } } }).document
                  ?.body?.innerText ?? ""
              ).slice(0, maximum),
            MAXIMUM_TEXT_CHARACTERS,
          )
          .catch(() => undefined),
      ]);

      const redirectChain = [
        ...(response?.request().redirectChain() ?? []).map((hop) => {
          const hopResponse = hop.response();
          const location = hopResponse?.headers()["location"];
          return Object.assign(
            {
              url: hop.url(),
              status: hopResponse?.status() ?? 0,
            },
            location !== undefined && { location },
          );
        }),
        ...(response !== null ? [{ url: response.url(), status: response.status() }] : []),
      ];

      return {
        requestedUrl: redirectChain[0]?.url ?? page.url(),
        finalUrl: page.url(),
        redirectChain,
        responseHeaders: response?.headers() ?? {},
        screenshotBase64: screenshot,
        ...(title !== undefined && title !== "" && { title }),
        ...(text !== undefined && text !== "" && { markdown: text }),
        links,
      };
    },

    async release() {
      await detach();
      // Disconnect, NOT close: the browser outlives this stream so the next one — another tab, a
      // dropped connection coming back — finds it with its cookies.
      await browser.disconnect().catch(() => {});
    },

    async close() {
      await detach();
      await browser.close().catch(() => {});
    },
  };
}
