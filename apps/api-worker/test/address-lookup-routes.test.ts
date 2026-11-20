/*
 * Address autocomplete through the real chokepoint. Two states matter and both are pinned: the
 * SHIPPED state, where no Google key is set and every answer is `unavailable`, and the provisioned
 * state, reached here by handing the app an environment carrying the key while the outbound call to
 * Google is answered by a stub — the same production-wiring shape
 * scan-unreachable-engine-seam.test.ts takes for the scan engine.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

const app = createApp();
const base = "https://example.com/api/v1/address-lookup";
const PROVISIONED = { ...env, GOOGLE_PLACES_API_KEY: "google-key" };
const UNPROVISIONED = { ...env, GOOGLE_PLACES_API_KEY: undefined };

let firmId: FirmId;
let ownerCookie: string;
let unprivilegedCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Address Lookup Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  const { userId } = await seedCredentialedUser("address-lookup-owner@example.com", {
    userName: "Lookup Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Lookup Owner", firmId);
  ownerCookie = await signInForSessionCookie("address-lookup-owner@example.com");
  // Present in the firm but holding no role, so no directory:edit.
  await seedCredentialedUser("address-lookup-no-role@example.com", {
    userName: "No Role",
    firmId,
  });
  unprivilegedCookie = await signInForSessionCookie("address-lookup-no-role@example.com");
});

function post(path: string, body: unknown, cookie?: string): [string, RequestInit] {
  return [
    `${base}/${path}`,
    {
      method: "POST",
      headers: {
        ...(cookie === undefined ? {} : { cookie }),
        origin: "https://example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  ];
}

/** Answer Google's Places host from a script, count what reached it, and let the rest through. */
const originalFetch = globalThis.fetch;
const googleCalls: URL[] = [];
function answerGoogleWith(answer: (url: URL) => Response): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "places.googleapis.com") {
      googleCalls.push(url);
      return Promise.resolve(answer(url));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  googleCalls.length = 0;
});

describe("who may ask", () => {
  it("refuses a caller with no session", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }),
      UNPROVISIONED,
    );
    expect(response.status).toBe(401);
  });

  it("refuses a member without directory:edit", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, unprivilegedCookie),
      UNPROVISIONED,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a country that is not an alpha-2 code", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "USA", query: "14 Rose" }, ownerCookie),
      UNPROVISIONED,
    );
    expect(response.status).toBe(422);
  });
});

describe("the shipped state: no key set", () => {
  it("answers unavailable to both operations, and asks nobody", async () => {
    answerGoogleWith(() => new Response("must not be called", { status: 500 }));
    const suggestions = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, ownerCookie),
      UNPROVISIONED,
    );
    expect(suggestions.status).toBe(200);
    expect(await suggestions.json()).toEqual({ outcome: "unavailable" });

    const resolution = await app.request(
      ...post("resolutions", { suggestionId: "anything" }, ownerCookie),
      UNPROVISIONED,
    );
    expect(await resolution.json()).toEqual({ outcome: "unavailable" });
    expect(googleCalls).toHaveLength(0);
  });

  it("treats a blank key as none", async () => {
    answerGoogleWith(() => new Response("must not be called", { status: 500 }));
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, ownerCookie),
      { ...env, GOOGLE_PLACES_API_KEY: "  " },
    );
    expect(await response.json()).toEqual({ outcome: "unavailable" });
    expect(googleCalls).toHaveLength(0);
  });
});

describe("the provisioned state", () => {
  it("offers addresses, resolves the chosen one, and marks the offers as Google's", async () => {
    answerGoogleWith((url) =>
      url.pathname.endsWith(":autocomplete")
        ? Response.json({
            suggestions: [
              {
                placePrediction: {
                  placeId: "ChIJ-reno_14",
                  text: { text: "14 Rosewood Dr, Reno, NV, USA" },
                },
              },
            ],
          })
        : Response.json({
            addressComponents: [
              { longText: "14", shortText: "14", types: ["street_number"] },
              { longText: "Rosewood Drive", shortText: "Rosewood Dr", types: ["route"] },
              { longText: "Reno", shortText: "Reno", types: ["locality"] },
              { longText: "Nevada", shortText: "NV", types: ["administrative_area_level_1"] },
              { longText: "89501", shortText: "89501", types: ["postal_code"] },
              { longText: "United States", shortText: "US", types: ["country"] },
            ],
          }),
    );
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, ownerCookie),
      PROVISIONED,
    );
    const offered = (await response.json()) as {
      outcome: string;
      attribution?: string;
      suggestions: { suggestionId: string; label: string }[];
    };
    expect(offered.outcome).toBe("suggestions");
    expect(offered.attribution).toBe("google-maps");
    expect(offered.suggestions[0]?.label).toBe("14 Rosewood Dr, Reno, NV, USA");

    const resolution = await app.request(
      ...post("resolutions", { suggestionId: offered.suggestions[0]!.suggestionId }, ownerCookie),
      PROVISIONED,
    );
    expect(await resolution.json()).toEqual({
      outcome: "address",
      parts: {
        street: "14 Rosewood Dr",
        city: "Reno",
        region: "NV",
        postal: "89501",
        country: "US",
      },
    });
    expect(googleCalls.map((url) => url.pathname)).toEqual([
      "/v1/places:autocomplete",
      "/v1/places/ChIJ-reno_14",
    ]);
  });

  it("answers an identifier it never minted as expired, and asks nobody", async () => {
    answerGoogleWith(() => new Response("must not be called", { status: 500 }));
    const response = await app.request(
      ...post("resolutions", { suggestionId: "forged" }, ownerCookie),
      PROVISIONED,
    );
    expect(await response.json()).toEqual({ outcome: "expired" });
    expect(googleCalls).toHaveLength(0);
  });

  it("refuses with a retryable 502 when Google refuses, saying nothing of what was typed", async () => {
    answerGoogleWith(() => Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 }));
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rosewood" }, ownerCookie),
      PROVISIONED,
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const text = await response.text();
    expect(text).toContain("typed by hand");
    expect(text).not.toContain("Rosewood");
    expect(text).not.toContain("google-key");
  });
});
