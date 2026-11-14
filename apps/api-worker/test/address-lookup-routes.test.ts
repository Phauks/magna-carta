/*
 * Address autocomplete through the real chokepoint. Two states matter and both are pinned: the
 * SHIPPED state, where no Smarty key pair is provisioned and every answer is `unavailable`, and the
 * provisioned state, reached here by handing the app an environment carrying the pair while the
 * outbound call to Smarty is answered by a stub — the same production-wiring shape
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
const PROVISIONED = { ...env, SMARTY_AUTH_ID: "test-id", SMARTY_AUTH_TOKEN: "test-token" };

let firmId: FirmId;
let ownerUserId: string;
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
  ownerUserId = userId;
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

/** Answer Smarty's hosts from a script and let every other request through untouched. */
const originalFetch = globalThis.fetch;
const smartyCalls: URL[] = [];
function answerSmartyWith(answer: (url: URL) => Response): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname.endsWith(".api.smarty.com")) {
      smartyCalls.push(url);
      return Promise.resolve(answer(url));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  smartyCalls.length = 0;
});

describe("who may ask", () => {
  it("refuses a caller with no session", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("refuses a member without directory:edit", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, unprivilegedCookie),
      env,
    );
    expect(response.status).toBe(403);
  });

  it("refuses a country that is not an alpha-2 code", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "USA", query: "14 Rose" }, ownerCookie),
      env,
    );
    expect(response.status).toBe(422);
  });
});

describe("the shipped state: no key pair provisioned", () => {
  it("answers unavailable to both operations, and asks nobody", async () => {
    answerSmartyWith(() => new Response("must not be called", { status: 500 }));
    const suggestions = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, ownerCookie),
      { ...env, SMARTY_AUTH_ID: undefined, SMARTY_AUTH_TOKEN: undefined },
    );
    expect(suggestions.status).toBe(200);
    expect(await suggestions.json()).toEqual({ outcome: "unavailable" });

    const resolution = await app.request(
      ...post("resolutions", { suggestionId: "anything" }, ownerCookie),
      { ...env, SMARTY_AUTH_ID: undefined, SMARTY_AUTH_TOKEN: undefined },
    );
    expect(await resolution.json()).toEqual({ outcome: "unavailable" });
    expect(smartyCalls).toHaveLength(0);
  });

  it("treats half a key pair as none, rather than calling with a missing credential", async () => {
    answerSmartyWith(() => new Response("must not be called", { status: 500 }));
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, ownerCookie),
      { ...env, SMARTY_AUTH_ID: "test-id", SMARTY_AUTH_TOKEN: undefined },
    );
    expect(await response.json()).toEqual({ outcome: "unavailable" });
    expect(smartyCalls).toHaveLength(0);
  });
});

describe("the provisioned state", () => {
  it("offers addresses, and resolves a US one without a second call", async () => {
    answerSmartyWith(() =>
      Response.json({
        suggestions: [
          {
            street_line: "14 Rosewood Dr",
            secondary: "",
            city: "Reno",
            state: "NV",
            zipcode: "89501",
            entries: 0,
          },
        ],
      }),
    );
    const suggestions = await app.request(
      ...post("suggestions", { country: "us", query: "14 Rose" }, ownerCookie),
      PROVISIONED,
    );
    expect(suggestions.status).toBe(200);
    const offered = (await suggestions.json()) as {
      outcome: string;
      suggestions: { suggestionId: string; kind: string; label: string }[];
    };
    expect(offered.outcome).toBe("suggestions");
    expect(offered.suggestions[0]).toMatchObject({
      kind: "address",
      label: "14 Rosewood Dr, Reno, NV 89501",
    });
    expect(smartyCalls[0]!.searchParams.get("auth-id")).toBe("test-id");

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
    expect(smartyCalls).toHaveLength(1);
  });

  it("answers an identifier it never minted as expired", async () => {
    const response = await app.request(
      ...post("resolutions", { suggestionId: "forged" }, ownerCookie),
      PROVISIONED,
    );
    expect(await response.json()).toEqual({ outcome: "expired" });
  });

  it("answers no-coverage for a country the service cannot be asked about", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "XK", query: "Rruga" }, ownerCookie),
      PROVISIONED,
    );
    expect(await response.json()).toEqual({ outcome: "no-coverage" });
  });

  it("refuses with a retryable 502 when the service refuses, saying nothing of what was typed", async () => {
    answerSmartyWith(() => Response.json({ errors: [] }, { status: 402 }));
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rosewood" }, ownerCookie),
      PROVISIONED,
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const text = await response.text();
    expect(text).toContain("typed by hand");
    expect(text).not.toContain("Rosewood");
    expect(text).not.toContain("test-token");
  });
});

/** The address worker as the app sees it: a service binding that records what it was asked. */
function addressService(answer: (operation: string, body: Record<string, unknown>) => unknown) {
  const asked: { operation: string; body: Record<string, unknown> }[] = [];
  const binding = {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const request = new Request(input, init);
      const body = (await request.json()) as Record<string, unknown>;
      const operation = new URL(request.url).pathname;
      asked.push({ operation, body });
      return Response.json(answer(operation, body));
    },
  } as unknown as Fetcher;
  return { binding, asked };
}

const WAKE_FOREST = {
  number: "1402",
  street: "LAWSON CREEK WAY",
  unit: "",
  city: "WAKE FOREST",
  region: "NC",
  postcode: "27587",
  longitude: -78.51,
  latitude: 35.97,
};

function writeRequest(method: string, path: string, body: unknown): [string, RequestInit] {
  return [
    `https://example.com/api/v1/${path}`,
    {
      method,
      headers: {
        cookie: ownerCookie,
        origin: "https://example.com",
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
  ];
}

describe("the platform's own engine", () => {
  it("answers the United States from the address worker, with the region the form sent", async () => {
    answerSmartyWith(() => new Response("must not be called", { status: 500 }));
    const service = addressService(() => ({
      outcome: "suggestions",
      offers: [{ kind: "address", address: WAKE_FOREST }],
    }));
    const response = await app.request(
      ...post("suggestions", { country: "us", query: "1402 lawson", near: "nc" }, ownerCookie),
      { ...PROVISIONED, ADDRESS_SERVICE: service.binding },
    );
    const offered = (await response.json()) as {
      outcome: string;
      suggestions: { suggestionId: string; label: string }[];
    };
    expect(offered.outcome).toBe("suggestions");
    expect(offered.suggestions[0]?.label).toBe("1402 Lawson Creek Way, Wake Forest, NC 27587");
    expect(service.asked).toEqual([
      {
        operation: "/suggestions",
        body: { country: "US", query: "1402 lawson", limit: 8, near: "NC" },
      },
    ]);
    expect(smartyCalls).toHaveLength(0);

    const resolution = await app.request(
      ...post("resolutions", { suggestionId: offered.suggestions[0]!.suggestionId }, ownerCookie),
      { ...PROVISIONED, ADDRESS_SERVICE: service.binding },
    );
    expect(await resolution.json()).toEqual({
      outcome: "address",
      parts: {
        street: "1402 Lawson Creek Way",
        city: "Wake Forest",
        region: "NC",
        postal: "27587",
        country: "US",
      },
      location: { latitude: 35.97, longitude: -78.51 },
    });
    // An address carries its own parts: choosing it asked the worker nothing more.
    expect(service.asked).toHaveLength(1);
  });

  it("sends every other country to Smarty when it is provisioned, and covers none when it is not", async () => {
    answerSmartyWith(() => Response.json({ candidates: [] }));
    const service = addressService(() => ({ outcome: "suggestions", offers: [] }));
    const viaSmarty = await app.request(
      ...post("suggestions", { country: "CA", query: "12 Rue" }, ownerCookie),
      { ...PROVISIONED, ADDRESS_SERVICE: service.binding },
    );
    expect(await viaSmarty.json()).toEqual({ outcome: "suggestions", suggestions: [] });
    expect(smartyCalls).toHaveLength(1);

    const uncovered = await app.request(
      ...post("suggestions", { country: "CA", query: "12 Rue" }, ownerCookie),
      {
        ...env,
        SMARTY_AUTH_ID: undefined,
        SMARTY_AUTH_TOKEN: undefined,
        ADDRESS_SERVICE: service.binding,
      },
    );
    expect(await uncovered.json()).toEqual({ outcome: "no-coverage" });
    expect(service.asked).toHaveLength(0);
  });

  it("stands the caller's primary office in for a region the form did not send", async () => {
    const created = await app.request(
      ...writeRequest("POST", "locations", { name: "Raleigh", numberCode: "RAL" }),
      env,
    );
    expect(created.status).toBe(201);
    const { id: locationId } = (await created.json()) as { id: string };
    const addressed = await app.request(
      ...writeRequest("PUT", `locations/${locationId}/addresses`, {
        addresses: [{ kind: "physical", street: "1 Fayetteville St", region: "NC", country: "US" }],
      }),
      env,
    );
    expect(addressed.status).toBe(200);
    const staffed = await app.request(
      ...writeRequest("PUT", `locations/${locationId}/members/${ownerUserId}`, { isPrimary: true }),
      env,
    );
    expect(staffed.status).toBeLessThan(300);

    const service = addressService(() => ({ outcome: "suggestions", offers: [] }));
    await app.request(
      ...post("suggestions", { country: "US", query: "1402 lawson" }, ownerCookie),
      {
        ...env,
        ADDRESS_SERVICE: service.binding,
      },
    );
    expect(service.asked[0]?.body.near).toBe("NC");

    // What the form sent wins over the office.
    await app.request(
      ...post("suggestions", { country: "US", query: "1402 lawson", near: "TX" }, ownerCookie),
      { ...env, ADDRESS_SERVICE: service.binding },
    );
    expect(service.asked[1]?.body.near).toBe("TX");
  });

  it("answers unavailable while the worker has no index built yet", async () => {
    const service = addressService(() => ({ outcome: "unavailable" }));
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "1402 lawson" }, ownerCookie),
      { ...env, ADDRESS_SERVICE: service.binding },
    );
    expect(await response.json()).toEqual({ outcome: "unavailable" });
  });

  it("refuses a bias that is not a subdivision code", async () => {
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "1402 lawson", near: "US-NC" }, ownerCookie),
      env,
    );
    expect(response.status).toBe(422);
  });
});

describe("Google, when its key is set", () => {
  /** Answer Google's Places host from a script, and count what reached it. */
  function answerGoogleWith(answer: (url: URL) => Response): URL[] {
    const calls: URL[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "places.googleapis.com") {
        calls.push(url);
        return Promise.resolve(answer(url));
      }
      if (url.hostname.endsWith(".api.smarty.com")) {
        smartyCalls.push(url);
        return Promise.resolve(new Response("must not be called", { status: 500 }));
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    return calls;
  }

  it("answers every country ahead of the others, and marks the offers as Google's", async () => {
    const calls = answerGoogleWith((url) =>
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
    const service = addressService(() => ({ outcome: "unavailable" }));
    const googleEnv = {
      ...PROVISIONED,
      GOOGLE_PLACES_API_KEY: "google-key",
      ADDRESS_SERVICE: service.binding,
    };
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, ownerCookie),
      googleEnv,
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
      googleEnv,
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
    expect(calls.map((url) => url.pathname)).toEqual([
      "/v1/places:autocomplete",
      "/v1/places/ChIJ-reno_14",
    ]);
    // Neither the self-hosted engine nor Smarty was asked.
    expect(service.asked).toHaveLength(0);
    expect(smartyCalls).toHaveLength(0);
  });

  it("marks no attribution on another engine's offers", async () => {
    answerSmartyWith(() =>
      Response.json({
        suggestions: [
          {
            street_line: "14 Rosewood Dr",
            city: "Reno",
            state: "NV",
            zipcode: "89501",
            entries: 0,
          },
        ],
      }),
    );
    const response = await app.request(
      ...post("suggestions", { country: "US", query: "14 Rose" }, ownerCookie),
      PROVISIONED,
    );
    const offered = (await response.json()) as { attribution?: string };
    expect(offered.attribution).toBeUndefined();
  });
});
