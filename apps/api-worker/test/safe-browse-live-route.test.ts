/*
 * The live browsing route's decisions, pinned without a browser.
 *
 * The test pool has no Browser Rendering binding, so everything the route decides AROUND the
 * browser — whether a second navigation reuses the first one's session, what a redirect refused
 * mid-chain answers, whether a failure ends the session so the next one starts clean, whether one
 * member can ever reach another's browser — would otherwise be checkable only by hand against the
 * deployed service. The navigator seam exists for this file.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { LiveSessionPlan } from "@magna-carta/safe-browse";
import { SsrfRejection } from "@magna-carta/integrations/safe-target";
import { createApp } from "../src/app.ts";
import type { LiveNavigationResult, LiveNavigator } from "../src/routes/safe-browse-live.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A navigator that records what the route asked of it and behaves like the real one where it
// matters: a connect plan comes back as the same session, a launch mints a new one.
function recordingNavigator(behaviour: "succeed" | "refuse-redirect" | "fail" = "succeed"): {
  navigator: LiveNavigator;
  plans: LiveSessionPlan[];
} {
  const plans: LiveSessionPlan[] = [];
  let minted = 0;
  return {
    plans,
    navigator: {
      async navigate(plan, href): Promise<LiveNavigationResult> {
        plans.push(plan);
        if (behaviour === "refuse-redirect") {
          throw new SsrfRejection("private", "a hop resolved to a private address");
        }
        if (behaviour === "fail") throw new Error("the page crashed");
        minted += 1;
        return {
          sessionId: plan.kind === "connect" ? plan.sessionId : `session-${minted}`,
          plan,
          finalUrl: href,
          redirectChain: [
            { url: "http://short.example/x", status: 301, location: href },
            { url: href, status: 200 },
          ],
          responseHeaders: { "content-type": "text/html" },
          screenshotBase64: "aGk=",
          title: "A page",
          text: "Visible words",
          links: ["https://elsewhere.example/"],
        };
      },
    },
  };
}

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

function navigate(app: ReturnType<typeof createApp>, cookie: string, url: string) {
  return app.request(
    "https://example.com/api/v1/safe-browse/live/navigate",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com", cookie },
      body: JSON.stringify({ url }),
    },
    env,
  );
}

function close(app: ReturnType<typeof createApp>, cookie: string) {
  return app.request(
    "https://example.com/api/v1/safe-browse/live/close",
    { method: "POST", headers: { origin: "https://example.com", cookie } },
    env,
  );
}

describe("POST /api/v1/safe-browse/live/navigate", () => {
  it("answers the capture's view shape, with the chain the session actually walked", async () => {
    const { navigator } = recordingNavigator();
    const app = createApp({ safeBrowseLiveDeps: { navigator } });
    const response = await navigate(app, await signedInMember(), "https://example.com/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // Field for field what the inspector renders — a missing chain would be padded to "answered
    // directly" on screen, which is the one thing this tool must not get wrong.
    expect(body).toMatchObject({
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      redirectChain: [
        { url: "http://short.example/x", status: 301, location: "https://example.com/" },
        { url: "https://example.com/", status: 200 },
      ],
      responseHeaders: { "content-type": "text/html" },
      screenshotBase64: "aGk=",
      markdown: "Visible words",
      links: ["https://elsewhere.example/"],
      sessionContinued: false,
    });
  });

  it("reuses the member's browser on the next step, which is the whole point", async () => {
    const { navigator, plans } = recordingNavigator();
    const app = createApp({ safeBrowseLiveDeps: { navigator } });
    const cookie = await signedInMember();
    await navigate(app, cookie, "https://example.com/one");
    const second = await navigate(app, cookie, "https://example.com/two");
    expect(plans.map((plan) => plan.kind)).toEqual(["launch", "connect"]);
    expect(plans[1]).toEqual({ kind: "connect", sessionId: "session-1" });
    expect(((await second.json()) as { sessionContinued: boolean }).sessionContinued).toBe(true);
  });

  it("never hands one member another member's browser", async () => {
    const { navigator, plans } = recordingNavigator();
    const app = createApp({ safeBrowseLiveDeps: { navigator } });
    await navigate(app, await signedInMember(), "https://example.com/a");
    await navigate(app, await signedInMember(), "https://example.com/b");
    // The second member's first step launches; it does not connect to the first member's session.
    expect(plans.map((plan) => plan.kind)).toEqual(["launch", "launch"]);
  });

  it("refuses a private typed address before any browser is acquired", async () => {
    const { navigator, plans } = recordingNavigator();
    const app = createApp({ safeBrowseLiveDeps: { navigator } });
    const response = await navigate(app, await signedInMember(), "http://127.0.0.1/admin");
    expect(response.status).toBe(400);
    expect(plans).toHaveLength(0);
    expect(await response.text()).not.toContain("127.0.0.1");
  });

  it("answers a redirect refused mid-chain with the same generic refusal, and ends the session", async () => {
    const refusing = recordingNavigator("refuse-redirect");
    const cookie = await signedInMember();
    const response = await navigate(
      createApp({ safeBrowseLiveDeps: { navigator: refusing.navigator } }),
      cookie,
      "https://suspect.example/bounce",
    );
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain("suspect.example");

    // The session was ended, so the member's next step launches rather than reconnecting to a
    // browser that was last pointed somewhere it should not have been.
    const next = recordingNavigator();
    await navigate(
      createApp({ safeBrowseLiveDeps: { navigator: next.navigator } }),
      cookie,
      "https://example.com/",
    );
    expect(next.plans.map((plan) => plan.kind)).toEqual(["launch"]);
  });

  it("answers a page that would not load as page-render-failed, never an Error ID", async () => {
    const { navigator } = recordingNavigator("fail");
    const response = await navigate(
      createApp({ safeBrowseLiveDeps: { navigator } }),
      await signedInMember(),
      "https://suspect.example/slow",
    );
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain("page-render-failed");
    expect(body).not.toContain("suspect.example");
  });
});

describe("POST /api/v1/safe-browse/live/close", () => {
  it("ends the session, so the next step starts a fresh browser", async () => {
    const { navigator, plans } = recordingNavigator();
    const app = createApp({ safeBrowseLiveDeps: { navigator } });
    const cookie = await signedInMember();
    await navigate(app, cookie, "https://example.com/one");
    const closed = await close(app, cookie);
    expect(closed.status).toBe(204);
    await navigate(app, cookie, "https://example.com/two");
    expect(plans.map((plan) => plan.kind)).toEqual(["launch", "launch"]);
  });

  it("is idempotent — closing when nothing is open is still success", async () => {
    const app = createApp({ safeBrowseLiveDeps: { navigator: recordingNavigator().navigator } });
    const response = await close(app, await signedInMember());
    expect(response.status).toBe(204);
  });
});
