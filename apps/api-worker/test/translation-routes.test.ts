/*
 * Translation through the real chokepoint. Three gates are pinned in the order a request meets them:
 * the member's tools:translation, the firm's translation.enabled switch (off until an administrator
 * turns it on), and whether the deployment has a Google key at all. Google itself is answered by a
 * stub on globalThis.fetch, the shape address-lookup-routes.test.ts takes for Smarty.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

const app = createApp();
const KEYED = { ...env, GOOGLE_TRANSLATE_API_KEY: "test-translate-key" };
const UNKEYED = { ...env, GOOGLE_TRANSLATE_API_KEY: undefined };

let ownerCookie: string;
let unprivilegedCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const { firmId } = await seedFirm({
    name: "Translation Firm",
    databaseIdentifier: "DB_FIRM_POOL_1",
  });
  const { userId } = await seedCredentialedUser("translation-owner@example.com", {
    userName: "Translation Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Translation Owner", firmId);
  ownerCookie = await signInForSessionCookie("translation-owner@example.com");
  await seedCredentialedUser("translation-no-role@example.com", {
    userName: "No Role",
    firmId,
  });
  unprivilegedCookie = await signInForSessionCookie("translation-no-role@example.com");
});

function request(
  method: string,
  path: string,
  cookie: string | undefined,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): [string, RequestInit] {
  return [
    `https://example.com/api/v1/${path}`,
    {
      method,
      headers: {
        ...(cookie === undefined ? {} : { cookie }),
        origin: "https://example.com",
        "content-type": "application/json",
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  ];
}

let settingWrites = 0;
async function setTranslationEnabled(enabled: boolean): Promise<void> {
  settingWrites += 1;
  const response = await app.request(
    ...request("PATCH", "firm/translation-settings", ownerCookie, { enabled }, {
      "Idempotency-Key": `translation-switch-${String(settingWrites)}`,
    }),
    KEYED,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled, engineConnected: true });
}

/** Answer Google's translation host from a script and let every other request through. */
const originalFetch = globalThis.fetch;
const googleCalls: { url: string; init: RequestInit | undefined }[] = [];
function answerGoogleWith(answer: (body: { q: string[] }) => Response): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname === "translation.googleapis.com") {
      googleCalls.push({ url, init });
      const body =
        typeof init?.body === "string" ? (JSON.parse(init.body) as { q: string[] }) : { q: [] };
      return Promise.resolve(answer(body));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  googleCalls.length = 0;
});

const SPANISH = "Estimado Sr. Ortega:\n\nLe escribimos en relación con el contrato.";

describe("who may translate", () => {
  it("refuses a caller with no session", async () => {
    const response = await app.request(
      ...request("POST", "translation/translate", undefined, { text: SPANISH, target: "en" }),
      KEYED,
    );
    expect(response.status).toBe(401);
  });

  it("refuses a member without tools:translation", async () => {
    const response = await app.request(
      ...request("POST", "translation/translate", unprivilegedCookie, {
        text: SPANISH,
        target: "en",
      }),
      KEYED,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a member without firm:manageAiSettings to read the firm's switch", async () => {
    const response = await app.request(
      ...request("GET", "firm/translation-settings", unprivilegedCookie),
      KEYED,
    );
    expect(response.status).toBe(403);
  });
});

describe("the firm's switch", () => {
  it("starts off, and an off switch sends nothing to Google", async () => {
    answerGoogleWith(() => new Response("must not be called", { status: 500 }));
    const settings = await app.request(
      ...request("GET", "firm/translation-settings", ownerCookie),
      KEYED,
    );
    expect(await settings.json()).toEqual({ enabled: false, engineConnected: true });

    const response = await app.request(
      ...request("POST", "translation/translate", ownerCookie, { text: SPANISH, target: "en" }),
      KEYED,
    );
    expect(response.status).toBe(422);
    expect(googleCalls).toHaveLength(0);
  });

  it("says when the deployment has no key", async () => {
    const settings = await app.request(
      ...request("GET", "firm/translation-settings", ownerCookie),
      UNKEYED,
    );
    expect(await settings.json()).toEqual({ enabled: false, engineConnected: false });
  });
});

describe("translating, with the switch on", () => {
  it("answers each paragraph beside its translation and keeps the key out of the URL", async () => {
    await setTranslationEnabled(true);
    answerGoogleWith(({ q }) =>
      Response.json({
        data: {
          translations: q.map((text) => ({
            translatedText: `EN ${text}`,
            detectedSourceLanguage: "es",
          })),
        },
      }),
    );
    const response = await app.request(
      ...request("POST", "translation/translate", ownerCookie, { text: SPANISH, target: "en" }),
      KEYED,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      passages: [
        { original: "Estimado Sr. Ortega:", translation: "EN Estimado Sr. Ortega:" },
        {
          original: "Le escribimos en relación con el contrato.",
          translation: "EN Le escribimos en relación con el contrato.",
        },
      ],
      source: "es",
      target: "en",
      engine: "google",
      characters: 62,
    });
    expect(googleCalls).toHaveLength(1);
    expect(googleCalls[0]?.url).not.toContain("test-translate-key");
    expect(new Headers(googleCalls[0]?.init?.headers).get("x-goog-api-key")).toBe(
      "test-translate-key",
    );
  });

  it("answers that translation is not set up when the deployment has no key", async () => {
    await setTranslationEnabled(true);
    answerGoogleWith(() => new Response("must not be called", { status: 500 }));
    const response = await app.request(
      ...request("POST", "translation/translate", ownerCookie, { text: SPANISH, target: "en" }),
      UNKEYED,
    );
    expect(response.status).toBe(422);
    expect(googleCalls).toHaveLength(0);
  });

  it("answers 502 when Google does not answer", async () => {
    await setTranslationEnabled(true);
    answerGoogleWith(() => new Response("down", { status: 503 }));
    const response = await app.request(
      ...request("POST", "translation/translate", ownerCookie, { text: SPANISH, target: "en" }),
      KEYED,
    );
    expect(response.status).toBe(502);
  });

  it("lists the engine's languages by name", async () => {
    answerGoogleWith(() =>
      Response.json({
        data: {
          languages: [
            { language: "es", name: "Spanish" },
            { language: "de", name: "German" },
          ],
        },
      }),
    );
    const response = await app.request(
      ...request("GET", "translation/languages?display=fr", ownerCookie),
      KEYED,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      languages: [
        { code: "de", name: "German" },
        { code: "es", name: "Spanish" },
      ],
    });
  });
});
