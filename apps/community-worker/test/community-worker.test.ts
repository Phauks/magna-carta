import { mintHandoffToken } from "@magna-carta/community/session";
import type { UserId } from "@magna-carta/identifiers/types";
import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "https://community.magnacarta.esq";
const SECRET = "a-test-secret-for-the-board-worker";
const NOW = new Date().toISOString();

beforeAll(async () => {
  await env.DB_CONTROL.batch([
    env.DB_CONTROL.prepare(
      "INSERT OR IGNORE INTO firm (id, name, created_at) VALUES ('frm_a', 'Firm A', ?1)",
    ).bind(NOW),
    env.DB_CONTROL.prepare(
      `INSERT OR IGNORE INTO user (id, name, email, firm_id, name_given, name_family, created_at, updated_at)
       VALUES ('usr_dana', 'Dana Reyes', 'dana@example.com', 'frm_a', 'Dana', 'Reyes', 0, 0)`,
    ),
    env.DB_CONTROL.prepare(
      `INSERT OR IGNORE INTO user (id, name, email, firm_id, created_at, updated_at)
       VALUES ('usr_loose', 'No Firm', 'loose@example.com', NULL, 0, 0)`,
    ),
  ]);
});

beforeEach(async () => {
  await env.DB_CONTROL.prepare("DELETE FROM community_board_switch").run();
});

// Follows the app's one-minute link and returns the session cookie the board set.
async function signIn(userId: string): Promise<string> {
  const token = await mintHandoffToken(SECRET, userId as UserId, Math.floor(Date.now() / 1000));
  const response = await SELF.fetch(`${ORIGIN}/session/begin?token=${encodeURIComponent(token)}`, {
    redirect: "manual",
  });
  expect(response.status).toBe(303);
  const cookie = response.headers.get("Set-Cookie") ?? "";
  expect(cookie).toMatch(/^__Host-community_session=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  return cookie.split(";")[0] ?? "";
}

function write(path: string, cookie: string, body: unknown, method = "POST") {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the board's headers", () => {
  it("keeps every answer out of search engines and passes no referrer", async () => {
    for (const path of ["/api/summary", "/session", "/api/nothing-here"]) {
      const response = await SELF.fetch(`${ORIGIN}${path}`);
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });
});

describe("reading", () => {
  it("serves the board to anyone, signed out", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/board?kind=request`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json<{ posts: unknown[]; total: number }>();
    expect(Array.isArray(body.posts)).toBe(true);
  });

  it("answers a signed-out session with the app's sign-in page", async () => {
    const body = await (await SELF.fetch(`${ORIGIN}/session`)).json<Record<string, unknown>>();
    expect(body).toMatchObject({ signedIn: false, canWrite: false, boardState: "open" });
    expect(body["signInUrl"]).toBe("https://magnacarta.esq/community-sign-in");
  });
});

describe("signing in", () => {
  it("redeems a link once", async () => {
    const token = await mintHandoffToken(
      SECRET,
      "usr_dana" as UserId,
      Math.floor(Date.now() / 1000),
    );
    const url = `${ORIGIN}/session/begin?token=${encodeURIComponent(token)}`;
    const first = await SELF.fetch(url, { redirect: "manual" });
    expect(first.headers.get("Location")).toBe("/");
    const second = await SELF.fetch(url, { redirect: "manual" });
    expect(second.headers.get("Location")).toBe("/?sign-in=expired");
    expect(second.headers.get("Set-Cookie")).toBeNull();
  });

  it("refuses a forged link", async () => {
    const forged = await mintHandoffToken(
      "another-secret",
      "usr_dana" as UserId,
      Math.floor(Date.now() / 1000),
    );
    const response = await SELF.fetch(`${ORIGIN}/session/begin?token=${forged}`, {
      redirect: "manual",
    });
    expect(response.headers.get("Location")).toBe("/?sign-in=expired");
  });

  it("reads a member's profile and suggested name", async () => {
    const cookie = await signIn("usr_dana");
    const body = await (
      await SELF.fetch(`${ORIGIN}/session`, { headers: { Cookie: cookie } })
    ).json<{ canWrite: boolean; profile: { suggestedDisplayName: string } }>();
    expect(body.canWrite).toBe(true);
    expect(body.profile.suggestedDisplayName).toBe("Dana R.");
  });
});

describe("writing", () => {
  it("posts a request for a signed-in member, held as their first", async () => {
    const cookie = await signIn("usr_dana");
    expect((await write("/api/profile", cookie, { displayName: "Dana R." }, "PUT")).status).toBe(
      200,
    );
    const response = await write("/api/posts", cookie, {
      kind: "request",
      category: "billing-and-invoicing",
      title: "Split one invoice across two trust accounts",
      body: "We often need this.",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ moderationState: "held" });
  });

  it("refuses a write with no session, from another site, or from a person with no firm", async () => {
    const signedOut = await SELF.fetch(`${ORIGIN}/api/posts`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(signedOut.status).toBe(401);

    const cookie = await signIn("usr_dana");
    const crossSite = await SELF.fetch(`${ORIGIN}/api/profile`, {
      method: "PUT",
      headers: {
        Cookie: cookie,
        Origin: "https://elsewhere.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Mallory" }),
    });
    expect(crossSite.status).toBe(403);

    const loose = await signIn("usr_loose");
    const noFirm = await write("/api/profile", loose, { displayName: "Someone" }, "PUT");
    expect(noFirm.status).toBe(403);
    expect(await noFirm.json()).toMatchObject({ title: "membership-required" });
  });

  it("refuses team actions from a member", async () => {
    const cookie = await signIn("usr_dana");
    const response = await write("/api/posts/1/status", cookie, { status: "planned" });
    expect([403, 404]).toContain(response.status);
  });
});

describe("the board switch", () => {
  it("refuses every write while read-only and keeps reads open", async () => {
    await env.DB_CONTROL.prepare(
      "INSERT INTO community_board_switch (id, state, changed_at) VALUES ('board', 'read-only', ?1)",
    )
      .bind(NOW)
      .run();
    const cookie = await signIn("usr_dana");
    const refused = await write("/api/profile", cookie, { displayName: "Dana R." }, "PUT");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ title: "board-read-only" });
    expect((await SELF.fetch(`${ORIGIN}/api/summary`)).status).toBe(200);
  });

  it("closes the board entirely when off", async () => {
    await env.DB_CONTROL.prepare(
      "INSERT INTO community_board_switch (id, state, changed_at) VALUES ('board', 'off', ?1)",
    )
      .bind(NOW)
      .run();
    const response = await SELF.fetch(`${ORIGIN}/api/summary`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ title: "board-off" });
  });
});

describe("the build identity", () => {
  it("answers the app's version probe, uncached and still noindex", async () => {
    const response = await SELF.fetch(`${ORIGIN}/__version`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  });
});
