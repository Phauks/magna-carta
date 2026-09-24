/*
 * The live stream's route and session object, pinned without a browser.
 *
 * The route's job is to refuse: no upgrade, another site's page, no permission. The object's job is
 * to keep one stream per member, remember which browser is theirs, and hand it over — cookies intact
 * — when a second tab opens Live. The test pool has no Browser Rendering binding, so the object's
 * opener is replaced on the instance with one that records what it was asked for.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { LiveSessionPlan } from "@magna-carta/safe-browse";
import type { LiveServerMessage } from "@magna-carta/safe-browse/live-stream-protocol";
import { createApp } from "../src/http/app.ts";
import type { LiveBrowser, LiveBrowserOpener } from "../src/safe-browse/live-stream.ts";
import { SafeBrowseSession, streamRequest } from "../src/safe-browse/safe-browse-session.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let poolFirmId: FirmId;
let emailSequence = 0;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Safe Browse Live Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

async function signedInMember(): Promise<string> {
  emailSequence += 1;
  const email = `safebrowse-live-${emailSequence}@example.com`;
  const { userId } = await seedCredentialedUser(email, {
    userName: "Live Walker",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Live Walker", poolFirmId);
  return signInForSessionCookie(email);
}

function openStream(cookie: string, headers: Record<string, string> = {}) {
  return createApp().request(
    "https://example.com/api/v1/safe-browse/live/stream?width=800&height=600",
    { headers: { cookie, ...headers } },
    env,
  );
}

describe("GET /api/v1/safe-browse/live/stream", () => {
  it("asks for an upgrade when the request is not one", async () => {
    const response = await openStream(await signedInMember());
    expect(response.status).toBe(426);
  });

  it("refuses an upgrade another site's page asked for", async () => {
    const response = await openStream(await signedInMember(), {
      upgrade: "websocket",
      origin: "https://attacker.example",
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Cross-origin");
  });

  it("refuses a caller with no session", async () => {
    const response = await createApp().request(
      "https://example.com/api/v1/safe-browse/live/stream",
      { headers: { upgrade: "websocket" } },
      env,
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/safe-browse/live/close", () => {
  it("is idempotent — closing when nothing is open is still success", async () => {
    const response = await createApp().request(
      "https://example.com/api/v1/safe-browse/live/close",
      {
        method: "POST",
        headers: { origin: "https://example.com", cookie: await signedInMember() },
      },
      env,
    );
    expect(response.status).toBe(204);
  });
});

// ---- the session object ----

function recordingOpener() {
  const plans: LiveSessionPlan[] = [];
  const outcomes: string[] = [];
  let minted = 0;
  const opener: LiveBrowserOpener = {
    async open(plan) {
      plans.push(plan);
      minted += 1;
      const sessionId = plan.kind === "connect" ? plan.sessionId : `session-${minted}`;
      const noop = async () => {};
      const browser: LiveBrowser = {
        sessionId,
        navigate: noop,
        history: noop,
        reload: noop,
        pointer: noop,
        wheel: noop,
        key: noop,
        insertText: noop,
        resize: noop,
        async inspect() {
          return {
            requestedUrl: "",
            finalUrl: "",
            redirectChain: [],
            responseHeaders: {},
            screenshotBase64: "",
            links: [],
          };
        },
        release: async () => void outcomes.push(`release:${sessionId}`),
        close: async () => void outcomes.push(`close:${sessionId}`),
      };
      return { browser, plan };
    },
  };
  return { opener, plans, outcomes };
}

async function connect(stub: DurableObjectStub<SafeBrowseSession>) {
  const response = await stub.fetch(streamRequest({ width: 800, height: 600 }));
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("no socket came back");
  const received: LiveServerMessage[] = [];
  socket.addEventListener("message", (event) =>
    received.push(JSON.parse(event.data as string) as LiveServerMessage),
  );
  socket.accept();
  return { socket, received };
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the condition never held");
}

function sessionObject(name: string) {
  const namespace = env.SAFE_BROWSE_SESSION as DurableObjectNamespace<SafeBrowseSession>;
  return namespace.get(namespace.idFromName(name));
}

describe("SafeBrowseSession streaming", () => {
  it("records the browser it opened, and a second tab takes it over with its cookies", async () => {
    const stub = sessionObject("firm-a:member-a");
    const { opener, plans, outcomes } = recordingOpener();
    await runInDurableObject(stub, (instance: SafeBrowseSession) => {
      instance.openLiveBrowser = () => opener;
    });

    const first = await connect(stub);
    await until(() => first.received.some((message) => message.type === "ready"));
    expect(first.received[0]).toMatchObject({ type: "ready", sessionContinued: false });
    expect(await stub.read()).toMatchObject({ sessionId: "session-1" });

    const second = await connect(stub);
    await until(() => second.received.some((message) => message.type === "ready"));
    // The first tab is told why it stopped and lets go; the second reconnects to the same browser.
    expect(first.received.at(-1)).toEqual({ type: "ended", reason: "replaced" });
    expect(outcomes).toEqual(["release:session-1"]);
    expect(plans.map((plan) => plan.kind)).toEqual(["launch", "connect"]);
    expect(second.received[0]).toMatchObject({ type: "ready", sessionContinued: true });

    // The member closing ends the stream and the browser for good, and forgets it.
    await stub.end();
    await until(() => second.received.some((message) => message.type === "ended"));
    expect(second.received.at(-1)).toEqual({ type: "ended", reason: "closed" });
    expect(outcomes).toEqual(["release:session-1", "close:session-1"]);
    expect(await stub.read()).toBeNull();
  });

  it("never hands one member another member's browser", async () => {
    const { opener, plans } = recordingOpener();
    for (const name of ["firm-b:member-one", "firm-b:member-two"]) {
      const stub = sessionObject(name);
      await runInDurableObject(stub, (instance: SafeBrowseSession) => {
        instance.openLiveBrowser = () => opener;
      });
      const stream = await connect(stub);
      await until(() => stream.received.some((message) => message.type === "ready"));
      await stub.end();
    }
    expect(plans.map((plan) => plan.kind)).toEqual(["launch", "launch"]);
  });
});
